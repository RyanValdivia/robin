---
type: infrastructure
name: vps
description: Acceso SSH y layout de discos del VPS (Oracle Cloud Ampere A1)
---

# VPS (Oracle Cloud Ampere A1, `rvaldiviase-instance`)

- **SSH:** `ssh ubuntu@dev.rvaldiviase.com` (también resuelve como
  `rvaldiviase.me`, mismo host — `dev.rvaldiviase.com` es el que está en
  `~/.ssh/config` con `User ubuntu` ya seteado, usar ese).
- No es un VPS dedicado a Robin — hostea ~26 contenedores de varios
  proyectos del usuario (Pterodactyl panel+wings, Turiston, Vaultwarden,
  evolution-api, Traefik, Homarr, Portainer, tailscale/headscale,
  stirling-pdf, metube, etc.), además de Robin.

## Discos

- `/` (`/dev/sda1`, ext4, 45GB) — disco de boot de la instancia, **fijo, no
  se puede agrandar**. Sistema operativo + antes tenía todo `/var/lib/docker`
  (ver [[robin]], sección "Migración del data-root de Docker" — ya no).
- `/var/lib/pterodactyl/volumes` (`/dev/sdb1`, ext4, 147GB, volumen de
  bloque Oracle vía iSCSI, `UUID` en `/etc/fstab`) — el disco grande con
  espacio de sobra. Pese al nombre (originalmente solo para volúmenes de
  servidores de juego de Pterodactyl), ahora también vive ahí
  `docker-data/` (el data-root completo de Docker, movido 2026-08-25). Es
  el lugar correcto para cualquier cosa nueva que necesite disco en este
  VPS — el root de 45GB queda solo para el sistema.

Ver [[robin]] para el detalle de la migración (procedimiento, downtime,
gotchas de rsync).
