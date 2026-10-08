/** Tokens de inyección para los puertos. Los tests reemplazan los adaptadores por estos tokens. */
export const ENV = Symbol('ENV');
export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');
export const MAILER = Symbol('MAILER');
export const ATTEMPT_STORE = Symbol('ATTEMPT_STORE');
export const AUTH = Symbol('AUTH');
export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const WHATSAPP_API = Symbol('WHATSAPP_API');
export const STORAGE = Symbol('STORAGE');
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const WOMPI_API = Symbol('WOMPI_API');
export const EMBEDDINGS_PROVIDER = Symbol('EMBEDDINGS_PROVIDER');
export const PAGE_FETCHER = Symbol('PAGE_FETCHER');
