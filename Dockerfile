# Single-container image: Mini App + API in one service (used by Render, see render.yaml).
# For your own server use docker-compose.yml instead.

FROM node:20-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/static UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend /src/dist /app/static
RUN useradd -m app && mkdir -p /app/uploads && chown -R app /app/uploads
USER app
EXPOSE 8000
# Render passes the port in $PORT; database migrations run before the server starts.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
