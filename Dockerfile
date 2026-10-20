FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js domain.js local.cjs internet.cjs descargas.cjs reporte_diario.cjs SIPROPAN-1.5-reportes.apk ./
ENV NODE_ENV=production
USER node
EXPOSE 10000
CMD ["node", "internet.cjs"]
