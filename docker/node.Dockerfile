# Imagen de desarrollo: el código se monta como volumen, acá solo va el runtime.
FROM node:24-bookworm-slim
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app
