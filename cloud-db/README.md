# Personal Cloud Database

This package runs PostgreSQL on a Tencent Cloud Lighthouse server.

## First deployment

1. Install Docker and Docker Compose on the server.
2. Copy this directory to the server.
3. Copy `.env.example` to `.env` and set a long random password.
4. Run `docker compose up -d`.
5. Check the service with `docker compose ps` and `docker compose logs postgres`.

The database port is bound to `127.0.0.1`, so it is not directly exposed to the public internet. Use an API service later for remote application access, or use an SSH tunnel for administration.

## Connection inside the server

`postgresql://personal_user:YOUR_PASSWORD@127.0.0.1:5432/personal_db`

## Backup

On the Linux server, run `chmod +x backup.sh && ./backup.sh`. Copy the generated SQL file to a separate storage location; a backup kept on the same server does not protect against server loss.

The business tables are intentionally not predefined. Add them after confirming the data domains and relationships.
