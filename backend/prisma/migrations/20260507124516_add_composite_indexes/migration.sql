-- CreateIndex
CREATE INDEX "contratos_tenant_id_status_idx" ON "contratos"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "contratos_tenant_id_data_termino_idx" ON "contratos"("tenant_id", "data_termino");

-- CreateIndex
CREATE INDEX "contratos_tenant_id_responsavel_id_idx" ON "contratos"("tenant_id", "responsavel_id");

-- CreateIndex
CREATE INDEX "pendencias_tenant_id_status_idx" ON "pendencias"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "pendencias_tenant_id_prazo_resposta_idx" ON "pendencias"("tenant_id", "prazo_resposta");
