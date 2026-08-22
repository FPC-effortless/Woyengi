FROM node:24.18.0-alpine3.24

ENV NODE_ENV=production
ENV WOYENGI_HOST=0.0.0.0
WORKDIR /app
RUN addgroup -S woyengi && adduser -S -G woyengi -h /app woyengi \
    && mkdir -p /data && chown -R woyengi:woyengi /app /data
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global pnpm@11.19.0 \
    && pnpm install --prod --frozen-lockfile
COPY --chown=woyengi:woyengi . .
USER woyengi
EXPOSE 8080
CMD ["node", "services/platform-api/src/main.ts"]
