-- E05-S10 Resumen del cliente y próximo paso: se registran en ai_interactions (costo y tokens)
-- con su propio canal; no cuentan como respuestas del agente para la cuota.
ALTER TABLE ai_interactions DROP CONSTRAINT ai_interactions_channel_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_channel_check CHECK (channel IN ('whatsapp', 'preview', 'insight'));
