-- Reset del flujo de WhatsApp/originación para PRUEBAS LOCALES.
-- Borra conversaciones, solicitudes de crédito y sus documentos/extracciones/validaciones, además
-- de la idempotencia de webhooks (wamid). NO toca: tenant_config, whatsapp_channel, zone, borrower,
-- payment_plan, credit_document_requirement, ni créditos/cuotas ya otorgados.
--
-- Ejecutar como el superusuario del contenedor (omite RLS):
--   docker exec -i preztiaos-pg psql -U preztia -d preztiaos < docker/reset-whatsapp-test.sql
--
-- ⚠️ SOLO para entornos de desarrollo/prueba. Es irreversible.

BEGIN;

-- Hijos / trazas del expediente (sin FK física entre la mayoría; se borran primero por claridad).
DELETE FROM document_validation;
DELETE FROM document_extraction;
DELETE FROM credit_application_document;       -- FK → credit_application(id)
DELETE FROM credit_application_event;
DELETE FROM credit_application_rejection;

-- Idempotencia de webhooks: permite reprocesar los mismos wamid (al reenviar imágenes en pruebas).
DELETE FROM processed_inbound_message;

-- Transcript de la conversación con el cliente.
DELETE FROM conversation_message;

-- El expediente al final (lo referencia credit_application_document).
DELETE FROM credit_application;

COMMIT;
