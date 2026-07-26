FROM python:3.12-slim

# .pyc yazma, stdout/stderr'i tamponlama (log'lar anlık görünsün).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# psycopg (PostgreSQL) için sistem bağımlılıkları. --no-install-recommends ile
# gereksiz paketleri atla, sonra apt listelerini sil -> imaj küçük kalır.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# Katman cache'i: önce SADECE requirements'i kopyala ve bağımlılıkları kur.
# Böylece kod değişse de (bağımlılıklar değişmedikçe) pip adımı cache'ten gelir.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Uygulama kodunu bağımlılıklardan SONRA kopyala.
COPY . .

EXPOSE 8000
