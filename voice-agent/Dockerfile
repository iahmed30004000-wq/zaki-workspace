# The voice agent of «المساعد بالاجتماعات» (see README.md). CPU only; the models are downloaded once into the /models volume.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY logic.py agent.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV HF_HOME=/models/hf PORT=8080
VOLUME /models
EXPOSE 8080
ENTRYPOINT ["./entrypoint.sh"]
