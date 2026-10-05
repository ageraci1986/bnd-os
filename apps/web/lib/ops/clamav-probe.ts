import 'server-only';
import { Socket } from 'node:net';

/**
 * Sonde de vivacité clamd (spec 2026-10-05-clamav-monitoring-design §2).
 *
 * Ouvre une connexion TCP vers clamd, envoie `zPING\0` (commande « z » =
 * réponse terminée par NUL) et attend une réponse commençant par `PONG`.
 * Toute erreur (refus, reset, DNS), tout timeout ou toute réponse inattendue
 * → `false`. Le socket est TOUJOURS détruit, quel que soit le chemin.
 *
 * Ne lève jamais : l'appelant (cron `clamav-health`) ne traite qu'un booléen.
 */
export interface ClamavProbeOptions {
  readonly host: string;
  readonly port: number;
  /** Délai global (connexion + réponse), 5 s par défaut. */
  readonly timeoutMs?: number;
}

export function probeClamav({
  host,
  port,
  timeoutMs = 5000,
}: ClamavProbeOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new Socket();
    let settled = false;
    let received = '';

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    socket.setEncoding('utf8');
    socket.on('error', () => finish(false));
    socket.on('data', (chunk: string) => {
      received += chunk;
      if (received.startsWith('PONG')) {
        finish(true);
        return;
      }
      // Assez d'octets pour trancher (ou terminateur reçu) sans PONG → ko.
      if (received.length >= 4 || received.includes('\0')) finish(false);
    });
    socket.on('end', () => finish(received.startsWith('PONG')));
    socket.on('close', () => finish(received.startsWith('PONG')));

    socket.connect(port, host, () => {
      socket.write('zPING\0');
    });
  });
}
