CREATE TABLE IF NOT EXISTS "credit_application_document_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_type" "required_document" NOT NULL,
	"slot" integer NOT NULL,
	"media_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_application_document" ADD COLUMN "expected_files" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_application_document" ADD COLUMN "received_files" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_application_document" ADD COLUMN "mismatch_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_document_requirement" ADD COLUMN "expected_files" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_application_document_file" ADD CONSTRAINT "credit_application_document_file_application_id_credit_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_application"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_application_document_file_slot_idx" ON "credit_application_document_file" USING btree ("application_id","document_type","slot");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_application_document_file_media_idx" ON "credit_application_document_file" USING btree ("application_id","media_id");--> statement-breakpoint

-- RLS de aislamiento por tenant en la tabla de archivos de documentos
-- (mismo patrón que el resto de tablas: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE credit_application_document_file ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE credit_application_document_file FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON credit_application_document_file
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint

-- Un archivo archivado NUNCA se edita: su hash y su clave de almacenamiento son evidencia KYC.
-- El DELETE sí se permite porque reiniciar la solicitud ("quiero ingresar nuevamente los
-- documentos") retira los archivos de la ronda superada para liberar sus cupos.
REVOKE UPDATE ON credit_application_document_file FROM app;--> statement-breakpoint

-- Backfill: los documentos ya validados constan de un archivo (el único que existía antes de
-- que un documento pudiera tener varios). Sin esto quedarían como "0 de 1 archivos recibidos".
UPDATE credit_application_document SET received_files = 1 WHERE status = 'VALIDATED';