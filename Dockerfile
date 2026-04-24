FROM node:20-alpine AS builder

WORKDIR /app

# Copiar archivos de configuración de la raíz
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/

# Instalar dependencias (esto instalará todo el monorepo)
RUN npm install
RUN mkdir -p apps/api/node_modules

# Copiar el código fuente
COPY packages/core ./packages/core
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY bin ./bin

# Construir los paquetes y las apps
RUN npm run build --workspace=@autoclaw/core
RUN npm run build --workspace=web
RUN npm run build --workspace=api

# Imagen final
FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
# Explicitly copy local node_modules from API (now guaranteed to exist by mkdir)
COPY --from=builder /app/apps/api/node_modules/ ./apps/api/node_modules/
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/bin ./bin

# Ensure the linux binary is executable and add compat if needed
RUN apk add --no-cache libc6-compat && chmod +x ./bin/gog_linux

EXPOSE 3000

ENV NODE_ENV=production

# Ejecutar la API
CMD ["npm", "start", "--workspace=api"]
