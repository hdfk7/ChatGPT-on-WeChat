FROM python:3
ENV TZ=Asia/Shanghai
WORKDIR /app
ARG POETRY_VERSION=1.2.2
RUN echo "${TZ}" > /etc/timezone && \
    ln -sf /usr/share/zoneinfo/${TZ} /etc/localtime && \
    apt update && \
    apt install -y tzdata && \
    rm -rf /var/lib/apt/lists/* \
RUN apt-get update && \
    curl -sL https://deb.nodesource.com/setup_16.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/cache/apk/* && \
    pip3 install --no-cache-dir poetry && \
    rm -rf ~/.cache/
COPY package*.json ./
COPY pyproject.toml ./
COPY poetry.lock ./
# Install dependencies
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN poetry install && npm install && rm -rf ~/.npm/
COPY . .
CMD ["npm", "run", "dev"]
