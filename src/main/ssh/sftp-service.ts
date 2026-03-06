import SftpClient from "ssh2-sftp-client";
import type {
  SftpListItem,
  SftpReadFileMode,
  SftpReadFileResponse,
  SSHConnectionConfig,
} from "../../shared/types/ssh";
import { toSftpConnectConfig } from "./connect-config";
import { SSHServiceError } from "./errors";

type RawSftpListItem = {
  name: string;
  type: string;
  size: number;
  modifyTime: number;
  accessTime: number;
};

export class SftpService {
  private client: SftpClient | null = null;
  private currentConfig: SSHConnectionConfig | null = null;
  private connected = false;

  public bindConfig(config: SSHConnectionConfig): void {
    this.currentConfig = config;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = null;
    this.connected = false;

    try {
      await client.end();
    } catch {
      // Ignore end() errors because the transport might already be closed.
    }
  }

  public async list(remotePath: string): Promise<SftpListItem[]> {
    return this.withClient(async (client) => {
      const rawItems = (await client.list(remotePath)) as RawSftpListItem[];
      return rawItems.map((item) => ({
        name: item.name,
        path: toRemotePath(remotePath, item.name),
        type: mapSftpItemType(item.type),
        size: item.size,
        modifyTime: item.modifyTime,
        accessTime: item.accessTime,
      }));
    }, "SFTP list failed");
  }

  public async get(remotePath: string, localPath: string): Promise<void> {
    await this.withClient(
      async (client) => {
        await client.fastGet(remotePath, localPath);
      },
      "SFTP get failed",
    );
  }

  public async put(localPath: string, remotePath: string): Promise<void> {
    await this.withClient(
      async (client) => {
        await client.fastPut(localPath, remotePath);
      },
      "SFTP put failed",
    );
  }

  public async readFile(
    remotePath: string,
    mode: SftpReadFileMode = "text",
  ): Promise<SftpReadFileResponse> {
    return this.withClient(async (client) => {
      const rawData = await client.get(remotePath);

      if (Buffer.isBuffer(rawData)) {
        return {
          remotePath,
          mode,
          content: mode === "base64" ? rawData.toString("base64") : rawData.toString("utf8"),
        };
      }

      if (typeof rawData === "string") {
        return {
          remotePath,
          mode,
          content: mode === "base64" ? Buffer.from(rawData, "utf8").toString("base64") : rawData,
        };
      }

      throw new SSHServiceError(
        "sftp_error",
        "SFTP read file returned unsupported data type",
      );
    }, "SFTP read file failed");
  }

  public async writeText(remotePath: string, content = ""): Promise<void> {
    await this.withClient(
      async (client) => {
        await client.put(Buffer.from(content, "utf8"), remotePath);
      },
      "SFTP write text failed",
    );
  }

  public async mkdir(remotePath: string, recursive = true): Promise<void> {
    await this.withClient(
      async (client) => {
        await client.mkdir(remotePath, recursive);
      },
      "SFTP mkdir failed",
    );
  }

  public async rm(remotePath: string, recursive = false, isDirectory = false): Promise<void> {
    await this.withClient(
      async (client) => {
        if (isDirectory || recursive) {
          await client.rmdir(remotePath, recursive);
          return;
        }

        await client.delete(remotePath);
      },
      "SFTP rm failed",
    );
  }

  public async rename(fromPath: string, toPath: string): Promise<void> {
    await this.withClient(
      async (client) => {
        await client.rename(fromPath, toPath);
      },
      "SFTP rename failed",
    );
  }

  private async ensureConnected(): Promise<SftpClient> {
    if (this.connected && this.client) {
      return this.client;
    }

    if (!this.currentConfig) {
      throw new SSHServiceError("not_connected", "SFTP config is not bound");
    }

    const client = new SftpClient();
    try {
      await client.connect(toSftpConnectConfig(this.currentConfig));
      this.client = client;
      this.connected = true;
      return client;
    } catch (error) {
      this.connected = false;
      throw new SSHServiceError("sftp_error", "SFTP connect failed", error);
    }
  }

  private async withClient<T>(
    operation: (client: SftpClient) => Promise<T>,
    failureMessage: string,
  ): Promise<T> {
    const client = await this.ensureConnected();
    try {
      return await operation(client);
    } catch (error) {
      throw new SSHServiceError("sftp_error", failureMessage, error);
    }
  }
}

function mapSftpItemType(type: string): SftpListItem["type"] {
  if (type === "d") {
    return "directory";
  }

  if (type === "l") {
    return "link";
  }

  if (type === "-") {
    return "file";
  }

  return "unknown";
}

function toRemotePath(parentPath: string, childName: string): string {
  const normalizedParent = parentPath.endsWith("/") ? parentPath.slice(0, -1) : parentPath;
  if (!normalizedParent) {
    return `/${childName}`;
  }
  return `${normalizedParent}/${childName}`;
}
