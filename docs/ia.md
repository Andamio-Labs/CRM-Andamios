# Asistente de IA (E05)

El asistente responde por WhatsApp con la información del negocio, pasa a una persona cuando no sabe o el cliente lo pide, captura datos del lead y registra cada turno con su costo.

## Configuración

Hay un adaptador compatible con la API de OpenAI para el modelo y otro para los embeddings. Para cambiar de proveedor se cambian las variables de entorno, no el código.

| Variable | Groq | DeepSeek |
|---|---|---|
| `LLM_API` | `openai` | `openai` |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | `https://api.deepseek.com` |
| `LLM_MODEL` | p. ej. `llama-3.3-70b-versatile` | `deepseek-chat` |
| `LLM_API_KEY` | llave de Groq | llave de DeepSeek |
| `LLM_PRICE_INPUT_PER_MTOK` / `LLM_PRICE_OUTPUT_PER_MTOK` | USD por millón de tokens, según la tarifa vigente | ídem |

`LLM_TIMEOUT_MS` vale 8000 por defecto. La respuesta tiene que llegar en menos de 10 s (p95). Si el modelo no contesta a tiempo, la conversación pasa a una persona.

**Embeddings:** ni Groq ni DeepSeek los ofrecen, así que se usa un modelo local.

```bash
docker compose --profile ia up -d ollama
docker compose exec ollama ollama pull bge-m3
EMBEDDINGS_API=openai EMBEDDINGS_BASE_URL=http://ollama:11434/v1 EMBEDDINGS_MODEL=bge-m3 docker compose up
```

La columna `knowledge_chunks.embedding` es `vector(1024)`, la dimensión de `bge-m3`. Un modelo con otra dimensión necesita una migración y volver a indexar todo. El adaptador rechaza vectores de otro tamaño, así que un error de configuración no pasa en silencio.

**Simuladores:** `LLM_API=local` y `EMBEDDINGS_API=local` responden sin red. Se usan en desarrollo (son los valores por defecto de `docker compose up`) y en los tests. **En producción `loadEnv` los rechaza.**

## Un turno del agente

1. **Inbound:** el webhook guarda el mensaje. Si el agente está activo, de turno según su horario y la conversación no está en pausa, se encola `ai.reply` con 1,5 s de espera. En ese caso no se envía el mensaje automático de fuera de horario.
2. **¿Sigue siendo su turno?** Si llegó otro mensaje del cliente, lo responde el job de ese mensaje. Si ya salió una respuesta, no se hace nada.
3. **Cuota:** si se agotó y el bloqueo está activo, no responde y queda registrado como `quota`.
4. **Palabra de escalamiento:** con "asesor", "humano" o las palabras configuradas, pasa a una persona sin consultar al modelo.
5. **Guardrail de entrada:**
   - un intento de manipulación recibe una respuesta segura, sin llamar al modelo;
   - las tarjetas y contraseñas se tapan antes de salir hacia el proveedor.
6. **Búsqueda:** se calcula el embedding de los últimos mensajes del cliente y se traen los 4 fragmentos más cercanos de la base. Es una búsqueda exacta, aislada por RLS.
7. **Modelo:** una sola llamada en modo JSON que devuelve `{ reply, handoff, fields }`, es decir, responde, decide si escalar y califica a la vez.
8. **Guardrail de salida:** la respuesta no se envía y la conversación pasa a una persona en dos casos:
   - cita un precio o porcentaje que no está en la base ni en lo que dijo el cliente;
   - repite las reglas internas.
9. **Guardado en una transacción:**
   - la respuesta (`ai_generated`, sin `sent_by`, así que no cuenta para el SLA);
   - los datos capturados (solo campos vacíos);
   - la pausa;
   - el registro y los avisos.

   El envío sale después del commit.

## Traspaso y pausa (E05-S05)

| Motivo | Hasta cuándo |
|---|---|
| `human_reply`: respondió una persona | 24 horas desde su respuesta |
| `handoff`: el asistente pasó la conversación | Hasta reanudar a mano |
| `guardrail`: frenó una respuesta | Hasta reanudar a mano |
| `manual`: botón en la bandeja | Hasta reanudar a mano. No se acorta aunque responda una persona |

La pausa sin vencimiento se guarda como `9999-12-31`. No se usa `'infinity'`: el driver la lee como `Infinity`, Drizzle la convierte en `Invalid Date` y la pausa dejaba de funcionar sin dar error.

## Cuota y costos (E05-S06, E05-S08)

- La cuota cuenta las respuestas enviadas por WhatsApp en el mes calendario, en la zona horaria de la empresa. El límite sale del plan (`aiRepliesPerMonth`). El simulador no cuenta.
- Al llegar al 80 % y al 100 % se avisa al propietario y a los admins, una vez por umbral y por mes (`ai_usage_alerts`).
- Cada turno queda en `ai_interactions` con su prompt, respuesta, modelo, tokens, costo (en micro-USD), latencia, fuentes y datos capturados.
  - Solo lo ve el propietario (`ai:logs`).
  - No se puede editar.
  - Se borra con la conversación, por ejemplo en la supresión de un titular.

## Decisiones técnicas que no conviene revertir

- **Sin índice HNSW.** Con RLS, un índice aproximado busca entre los vectores de todas las empresas y filtra después, así que puede devolver menos resultados de los pedidos. Por empresa hay pocos miles de fragmentos y la búsqueda exacta es rápida. Si una empresa crece mucho, conviene particionar o agregar índices parciales por tenant.
- **Orden de los mensajes.** La hora de Meta viene en segundos y la de nuestras respuestas en milisegundos, por eso nunca se comparan relojes distintos:
  - "¿llegó otro mensaje?" compara entrantes entre sí;
  - "¿ya respondió alguien?" compara contra el momento en que *registramos* el entrante (`status_updated_at`);
  - el historial que recibe el modelo va en orden de llegada al servidor.

  Las comparaciones se hacen en SQL, porque traer las fechas a JS las trunca a milisegundos.
- **Fuente URL.** La IP se valida en el `lookup` del socket y no antes del request, para que un DNS que cambia (DNS rebinding) no la saltee. Se aceptan solo `http` y `https`, sin credenciales, hasta 2 MB, 10 s y 3 redirecciones, cada una validada de nuevo.
- **PDF.** Se extrae el texto con `unpdf` y el archivo no se conserva. Un PDF escaneado, sin texto, se rechaza con un mensaje claro.

## Pendiente

- Probar con Groq o DeepSeek y con Ollama reales (llaves y elección de modelo), y medir la latencia p95.
- Retención del registro: hoy se conserva mientras exista la conversación. Hay que definir el plazo junto con el aviso de privacidad (E13-S01).
- Fase 2: notas de voz (E05-S09), resumen de conversación (E05-S10) y agendamiento (E05-S11).
