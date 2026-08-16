FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/src/templates/ dist/templates/
COPY --from=builder /app/src/template-config.json dist/template-config.json
COPY migrations/ migrations/
COPY .sequelizerc .sequelizerc
COPY sequelize.config.cjs sequelize.config.cjs
USER app
CMD ["node", "dist/main.js"]
