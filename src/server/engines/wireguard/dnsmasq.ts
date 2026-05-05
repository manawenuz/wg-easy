import { spawn, type ChildProcess } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import debug from 'debug';

const DNS_DEBUG = debug('WireGuard');
const CONF_PATH = '/etc/dnsmasq.d/wg-easy.conf';
const CONF_DIR = '/etc/dnsmasq.d';

export interface DnsmasqAddresses {
  ifaceName: string;
  ipv4: string;            // e.g. 10.8.0.1
  ipv6?: string | null;    // e.g. fdcc:ad94:bacf:61a4::cafe:1
}

export class DnsmasqManager {
  #proc: ChildProcess | null = null;
  #addresses: DnsmasqAddresses | null = null;

  async start(
    upstream: string[],
    enableIpv6: boolean,
    addresses?: DnsmasqAddresses
  ): Promise<void> {
    await this.stop();
    if (addresses) this.#addresses = addresses;
    await mkdir(CONF_DIR, { recursive: true });
    await writeFile(CONF_PATH, this.#buildConf(upstream, enableIpv6));

    this.#proc = spawn('dnsmasq', ['--keep-in-foreground', '--conf-file=/etc/dnsmasq.conf', `--conf-dir=${CONF_DIR}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.#proc.stdout?.on('data', (d: Buffer) => DNS_DEBUG('dnsmasq:', d.toString().trim()));
    this.#proc.stderr?.on('data', (d: Buffer) => DNS_DEBUG('dnsmasq err:', d.toString().trim()));
    this.#proc.on('exit', (code) => {
      DNS_DEBUG(`dnsmasq exited with code ${code}`);
      this.#proc = null;
    });

    DNS_DEBUG('dnsmasq started');
  }

  async reload(
    upstream: string[],
    enableIpv6: boolean,
    addresses?: DnsmasqAddresses
  ): Promise<void> {
    if (addresses) this.#addresses = addresses;
    if (!this.#proc) {
      await this.start(upstream, enableIpv6, addresses);
      return;
    }
    await writeFile(CONF_PATH, this.#buildConf(upstream, enableIpv6));
    this.#proc.kill('SIGHUP');
    DNS_DEBUG('dnsmasq reloaded');
  }

  async stop(): Promise<void> {
    if (this.#proc) {
      this.#proc.kill();
      this.#proc = null;
      DNS_DEBUG('dnsmasq stopped');
    }
  }

  #buildConf(upstream: string[], _enableIpv6: boolean): string {
    // Use bind-dynamic so dnsmasq listens on whatever addresses are live on
    // the wg interface — we don't have to compute the gateway IP from the
    // stored CIDR (which is sometimes the network base, sometimes the host
    // address, depending on how it was set). bind-dynamic also handles
    // address changes gracefully without restarting the daemon.
    const ifaceName = this.#addresses?.ifaceName ?? 'wg0';
    const lines = [
      'no-resolv',
      'no-hosts',
      'no-poll',
      'bind-dynamic',
      `interface=${ifaceName}`,
      'except-interface=lo',
      'cache-size=1000',
      'neg-ttl=300',
    ];
    for (const s of upstream) {
      lines.push(`server=${s}`);
    }
    return lines.join('\n') + '\n';
  }
}
