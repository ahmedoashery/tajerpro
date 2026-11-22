FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && node .output/server/index.mjs"]
