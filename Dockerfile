FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js domain.js local.cjs internet.cjs descargas.cjs reporte_diario.cjs web.cjs index.html panaderia.js panaderia.css SIPROPAN-1.6-listados.apk ./
ENV NODE_ENV=production
USER node
EXPOSE 10000
CMD ["node", "internet.cjs"]
