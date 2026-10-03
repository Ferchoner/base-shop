#!/usr/bin/env bash
# Smoke test of the production images (ADR-0147): the migrate image applies every migration to an empty
# PostgreSQL 18, and the production image starts against it and answers a route that reads the database and
# one that hashes with argon2. The production image does not install peer dependencies on their own, so this
# catches a package the API needs at runtime and only gets as a peer.
#
# Usage: bash .github/scripts/smoke-test-images.sh [api image] [migrate image]
set -euo pipefail

readonly API_IMAGE="${1:-base-shop:ci}"
readonly MIGRATE_IMAGE="${2:-base-shop-migrate:ci}"
readonly NAME="base-shop-smoke-$$"

# Throwaway values for a database that lives only during the test.
password="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
jwt_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
readonly DATABASE_URL="postgresql://postgres:${password}@${NAME}-db:5432/shop"

cleanup() {
  docker rm --force "${NAME}-db" "${NAME}-api" >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "Smoke test failed: $1"
  echo '--- API log ---'
  docker logs "${NAME}-api" 2>&1 | tail -40 || true
  exit 1
}

docker network create "$NAME" >/dev/null
docker run --detach --name "${NAME}-db" --network "$NAME" \
  --env POSTGRES_PASSWORD="$password" --env POSTGRES_DB=shop postgres:18 >/dev/null
for _ in $(seq 1 60); do
  docker exec "${NAME}-db" pg_isready --username postgres --dbname shop >/dev/null 2>&1 && break
  sleep 1
done
# pg_isready answers during the first start too; wait until the server accepts queries.
for _ in $(seq 1 30); do
  docker exec "${NAME}-db" psql --username postgres --dbname shop --command 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done

echo 'Applying the migrations with the migrate image'
docker run --rm --network "$NAME" --env DATABASE_URL="$DATABASE_URL" "$MIGRATE_IMAGE"

echo 'Starting the production image'
docker run --detach --name "${NAME}-api" --network "$NAME" \
  --env NODE_ENV=production \
  --env DATABASE_URL="$DATABASE_URL" \
  --env JWT_SECRET="$jwt_secret" \
  --env SMTP_HOST=localhost \
  --env SMTP_PORT=1025 \
  --env MAIL_FROM='base-shop <no-reply@shop.example.com>' \
  --env FRONTEND_BASE_URL=https://shop.example.com \
  --env IMAGE_BASE_URL=https://shop.example.com/media \
  "$API_IMAGE" >/dev/null

# The status of a request made from inside the API container, which has Node.js and no curl.
status_of() {
  docker exec "${NAME}-api" node --input-type=module --eval "
    const response = await fetch('http://localhost:3000$1', {
      method: '$2',
      headers: { 'content-type': 'application/json' },
      body: '$2' === 'GET' ? undefined : process.argv[1],
    });
    console.log(response.status);
  " "${3:-}" 2>/dev/null || echo 0
}

started=0
for _ in $(seq 1 60); do
  if [[ "$(status_of /v1/catalog/categories GET)" == 200 ]]; then
    started=1
    break
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "${NAME}-api")" != true ]]; then
    fail 'the API stopped while starting'
  fi
  sleep 1
done
[[ "$started" -eq 1 ]] || fail 'GET /v1/catalog/categories never answered 200'
echo 'GET /v1/catalog/categories: 200'

login="$(status_of /v1/auth/login POST '{"email":"nadie@example.com","password":"una-contraseña-larga-de-prueba"}')"
[[ "$login" == 401 ]] || fail "POST /v1/auth/login answered ${login} instead of 401"
echo 'POST /v1/auth/login with an unknown email: 401'

echo 'Smoke test passed'
