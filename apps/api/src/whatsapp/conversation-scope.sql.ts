import { sql, type SQL } from 'drizzle-orm';
import type { ConversationFilters } from '@preztiaos/contracts';
import { zoneScopePredicate } from '../iam/zone-scope';
import type { Session } from '../auth/require-role';

/**
 * Construcción del read model de la bandeja de WhatsApp, COMPARTIDA por el listado, la
 * estadística y la limpieza masiva: los tres deben ver exactamente el mismo conjunto de
 * conversaciones o la purga borraría algo distinto de lo que el operador está mirando.
 *
 * El resultado es un CTE `enriched` con una fila por teléfono: actividad agregada dentro del
 * rango, último mensaje, solicitud asociada, fallos técnicos y el DESENLACE derivado.
 */

// Precedencia del desenlace (ver `conversationOutcome` en el contrato): el estado del expediente
// manda, y la falla técnica solo clasifica cuando la solicitud no llegó a completarse.
const OUTCOME_CASE = sql`CASE
  WHEN app.status = 'APPROVED'  THEN 'APPROVED'
  WHEN app.status = 'REJECTED'  THEN 'REJECTED'
  WHEN app.status = 'IN_REVIEW' THEN 'PENDING_APPROVAL'
  WHEN fail.failure_count > 0   THEN 'TECHNICAL_FAILURE'
  WHEN app.id IS NOT NULL       THEN 'INCOMPLETE'
  ELSE 'ONLY_INQUIRY'
END`;

/**
 * Rango de fechas de NEGOCIO, inclusive en ambos extremos: el `hasta` abarca el día completo
 * (`< día siguiente`) para que un mensaje de las 18:00 no quede fuera al filtrar por su fecha.
 */
function dateRangePredicates(column: SQL, filters: ConversationFilters): SQL[] {
  const predicates: SQL[] = [];
  if (filters.from) predicates.push(sql`${column} >= ${filters.from}::date`);
  if (filters.to) {
    predicates.push(sql`${column} < (${filters.to}::date + interval '1 day')`);
  }
  return predicates;
}

/** Predicados sobre `conversation_message` que acotan qué mensajes entran al agregado. */
function messagePredicates(
  session: Session,
  filters: ConversationFilters,
): SQL[] {
  const predicates: SQL[] = [];
  const scope = zoneScopePredicate(session, sql`cm.zone_path`);
  if (scope) predicates.push(scope);
  if (filters.zonePath) {
    predicates.push(sql`cm.zone_path <@ ${filters.zonePath}::ltree`);
  }
  if (filters.channelId)
    predicates.push(sql`cm.channel_id = ${filters.channelId}`);
  predicates.push(...dateRangePredicates(sql`cm.created_at`, filters));
  return predicates;
}

function whereClause(predicates: SQL[]): SQL {
  return predicates.length
    ? sql`WHERE ${sql.join(predicates, sql` AND `)}`
    : sql``;
}

/**
 * CTE `enriched`: una fila por conversación, ya clasificada. Se consume con
 * `SELECT ... FROM enriched` añadiendo orden/paginación o agregación según el caso de uso.
 */
export function enrichedConversationsCte(
  session: Session,
  filters: ConversationFilters,
): SQL {
  // La búsqueda libre se aplica DESPUÉS de agrupar (HAVING) para que case con el teléfono o
  // con cualquier mensaje del cliente sin recortar los conteos del resto de la conversación.
  const search = filters.search
    ? sql`HAVING cm.applicant_phone ILIKE ${`%${filters.search}%`}
             OR bool_or(cm.body ILIKE ${`%${filters.search}%`})`
    : sql``;

  // Los fallos se acotan al mismo rango que los mensajes: la vista responde "qué pasó en esta
  // ventana", no "qué le pasó alguna vez a este cliente".
  const failureRange = dateRangePredicates(sql`cf.created_at`, filters);
  const failureWhere = whereClause([
    sql`cf.applicant_phone = s.applicant_phone`,
    ...failureRange,
  ]);

  return sql`
    WITH scoped AS (
      SELECT
        cm.applicant_phone                                            AS applicant_phone,
        min(cm.created_at)                                            AS first_at,
        max(cm.created_at)                                            AS last_at,
        count(*)::int                                                 AS message_count,
        count(*) FILTER (WHERE cm.direction = 'INBOUND')::int          AS inbound_count,
        count(*) FILTER (WHERE cm.direction = 'OUTBOUND')::int         AS outbound_count,
        max(cm.zone_path::text)                                       AS zone_path,
        max(cm.channel_id)                                            AS channel_id
      FROM conversation_message cm
      ${whereClause(messagePredicates(session, filters))}
      GROUP BY cm.applicant_phone
      ${search}
    ),
    enriched AS (
      SELECT
        s.*,
        last_msg.direction              AS last_direction,
        last_msg.kind                   AS last_kind,
        last_msg.body                   AS last_body,
        app.id                          AS application_id,
        app.status                      AS application_status,
        app.requested_amount_minor      AS requested_amount_minor,
        fail.failure_count              AS failure_count,
        fail.last_failure_at            AS last_failure_at,
        fail.last_stage                 AS last_failure_stage,
        fail.last_message               AS last_failure_message,
        coalesce(app.status = 'APPROVED', false) AS is_protected,
        ${OUTCOME_CASE}                 AS outcome
      FROM scoped s
      LEFT JOIN LATERAL (
        SELECT c.direction, c.kind, c.body
        FROM conversation_message c
        WHERE c.applicant_phone = s.applicant_phone AND c.created_at <= s.last_at
        ORDER BY c.created_at DESC
        LIMIT 1
      ) last_msg ON true
      LEFT JOIN LATERAL (
        SELECT ca.id, ca.status, ca.requested_amount_minor
        FROM credit_application ca
        WHERE ca.applicant_phone = s.applicant_phone
        ORDER BY ca.created_at DESC
        LIMIT 1
      ) app ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS failure_count,
          max(cf.created_at) AS last_failure_at,
          (array_agg(cf.stage         ORDER BY cf.created_at DESC))[1] AS last_stage,
          (array_agg(cf.error_message ORDER BY cf.created_at DESC))[1] AS last_message
        FROM conversation_failure cf
        ${failureWhere}
      ) fail ON true
    )
  `;
}

/**
 * Predicados que se aplican YA sobre `enriched` (dependen de columnas derivadas). Se mantienen
 * separados de los de mensajes porque no pueden evaluarse antes de agrupar.
 */
export function enrichedPredicates(filters: ConversationFilters): SQL {
  const predicates: SQL[] = [];
  if (filters.outcome) predicates.push(sql`e.outcome = ${filters.outcome}`);
  if (filters.withApplication)
    predicates.push(sql`e.application_id IS NOT NULL`);
  return whereClause(predicates);
}
