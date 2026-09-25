#!/bin/sh
set -e
npx prisma migrate deploy --schema prisma/schema.prisma
node dist/seed.js --if-empty
exec node dist/index.js
