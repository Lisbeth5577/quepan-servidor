FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY precios.cjs dashboard-ui.js dashboard.cjs index.js domain.js negocio.cjs consultas.cjs local.cjs internet.cjs descargas.cjs reporte_ordenado.cjs excel.cjs web.cjs index.html panaderia.js panaderia.css pan-pixel.png logo-academico.png QUEPAN-3.0.apk ./
ENV NODE_ENV=production
USER node
EXPOSE 10000
CMD ["node", "internet.cjs"]
