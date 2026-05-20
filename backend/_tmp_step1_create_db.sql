-- Execute conectado ao banco "postgres" (não ao brsupercarga)
-- Conexão: host=brsupercarga-db.cyjik0uca89e.us-east-1.rds.amazonaws.com user=postgres database=postgres

CREATE DATABASE sigid
  WITH OWNER = postgres
  ENCODING = 'UTF8'
  LC_COLLATE = 'en_US.UTF-8'
  LC_CTYPE = 'en_US.UTF-8'
  TEMPLATE = template0;
