FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir "hud>=0.6,<0.7"
COPY env.py tasks.py evidence.json README.md ./

CMD ["python", "env.py"]
