FROM node:24.18.0-alpine3.24

ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S woyengi && adduser -S -G woyengi -h /app woyengi \
    && mkdir -p /data && chown -R woyengi:woyengi /app /data
COPY --chown=woyengi:woyengi . .
USER woyengi
EXPOSE 8080
CMD ["node", "services/platform-api/src/main.ts"]
