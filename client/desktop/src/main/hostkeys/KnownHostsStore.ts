import { createHash, createHmac } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import {
  decodeBase64,
  evaluateHostKey,
  formatFingerprint,
  KNOWN_HOST_KEY_TYPE,
  knownKeyTypes,
  lookupName,
  parseKnownHosts,
  removeKnownHostLine,
  type HmacSha1,
  type HostKey,
  type HostKeyVerdict,
  type KnownHostsEntry,
  type KnownHostView,
} from '@btterm/core';
import { writeTextAtomic } from '../store/atomicWrite';

/**
 * known_hosts에 쓸 수 있는 호스트 이름(SEC-3): 영숫자·. _ : % - 만.
 * 공백·쉼표·제어문자·줄바꿈(다른 항목 끼워 넣기), 패턴 문자(* ? !), 맨 앞 | @ #(해시·표시·주석), 괄호를 막는다.
 */
const SAFE_HOST = /^[A-Za-z0-9._:%-]{1,255}$/;
const BASE64_KEY = /^[A-Za-z0-9+/]{1,16384}={0,2}$/;
const MAX_KNOWN_KEY_TYPES = 16;

const hmacSha1: HmacSha1 = (key, data) =>
  new Uint8Array(createHmac('sha1', key).update(data).digest());

/** 호스트 키(base64 blob)의 SHA256 지문 */
export function fingerprintOf(base64Key: string): string {
  return formatFingerprint(
    new Uint8Array(createHash('sha256').update(decodeBase64(base64Key)).digest()),
  );
}

/**
 * 호스트 키 저장소(F2.4). 앱 전용 파일은 읽고 쓰며, 사용자 ~/.ssh/known_hosts는 읽기만 한다.
 */
export class KnownHostsStore {
  /** 앱 파일 쓰기(추가·삭제)를 한 줄로 세운다. 지우는 동안 저장한 키가 덮이지 않게(보안 리뷰 L-1) */
  #writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly appFile: string,
    private readonly userFile: string | null,
  ) {}

  async evaluate(host: string, port: number, presented: HostKey): Promise<HostKeyVerdict> {
    return evaluateHostKey(await this.#entries(), host, port, presented, hmacSha1);
  }

  /**
   * 이 호스트에 저장된 키 종류(SEC-3). 연결 때 서버가 이 종류를 먼저 고르도록 session host로 넘긴다.
   * 경계 스키마를 통과하지 못할 이상한 종류는 뺀다.
   */
  async knownKeyTypes(host: string, port: number): Promise<string[]> {
    return knownKeyTypes(await this.#entries(), host, port, hmacSha1)
      .filter((type) => KNOWN_HOST_KEY_TYPE.test(type))
      .slice(0, MAX_KNOWN_KEY_TYPES);
  }

  /** 한 줄로 덧붙인다. 공백·쉼표·줄바꿈·패턴 문자로 다른 항목을 끼워 넣지 못하게 먼저 검사한다(SEC-3) */
  trust(host: string, port: number, key: HostKey): Promise<void> {
    if (!SAFE_HOST.test(host)) {
      return Promise.reject(new Error('known_hosts에 쓸 수 없는 호스트 이름'));
    }
    if (!KNOWN_HOST_KEY_TYPE.test(key.keyType) || !BASE64_KEY.test(key.key)) {
      return Promise.reject(new Error('known_hosts에 쓸 수 없는 키 형식'));
    }
    return this.#serial(() =>
      appendFile(this.appFile, `${lookupName(host, port)} ${key.keyType} ${key.key}\n`, 'utf8'),
    );
  }

  /** F2.4b: 앱 파일 항목(지울 수 있음)과 ~/.ssh 항목(읽기 전용) */
  async list(): Promise<KnownHostView[]> {
    const view = (source: KnownHostView['source']) => (entry: KnownHostsEntry) => ({
      source,
      line: entry.line,
      hosts: entry.hosts.kind === 'patterns' ? entry.hosts.patterns.join(',') : null,
      keyType: entry.keyType,
      key: entry.key,
      fingerprint: safeFingerprint(entry.key),
      marker: entry.marker,
    });
    return [
      ...(await readEntries(this.appFile)).map(view('app')),
      ...(await readEntries(this.userFile)).map(view('user')),
    ];
  }

  /**
   * 앱 파일에서만 지운다. 사용자 ~/.ssh/known_hosts는 쓰지 않는다.
   * confirm은 main의 확인창: renderer가 장악돼도 사용자 확인 없이는 지울 수 없다(보안 리뷰 M-1).
   * 폐기·인증기관 표시 항목은 지우지 않는다(L-3).
   */
  async remove(
    target: { line: number; keyType: string; key: string },
    confirm: (entry: KnownHostView) => Promise<boolean>,
  ): Promise<boolean> {
    const entry = (await this.list()).find(
      (e) =>
        e.source === 'app' &&
        e.line === target.line &&
        e.keyType === target.keyType &&
        e.key === target.key,
    );
    if (!entry || entry.marker !== null) return false;
    if (!(await confirm(entry))) return false;
    return this.#serial(async () => {
      const text = await readText(this.appFile);
      if (text === null) return false;
      // 확인하는 동안 파일이 바뀌었을 수 있으니 그 줄이 같은지 다시 본다
      const edit = removeKnownHostLine(text, target.line, target.keyType, target.key);
      if (edit.removed) await writeTextAtomic(this.appFile, edit.text);
      return edit.removed;
    });
  }

  async #entries(): Promise<KnownHostsEntry[]> {
    return [...(await readEntries(this.appFile)), ...(await readEntries(this.userFile))];
  }

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#writes.then(run, run);
    this.#writes = next.catch(() => undefined);
    return next;
  }
}

/** 잘못된 키 줄이 하나 있어도 목록 전체가 실패하지 않게(보안 리뷰 L-2) */
export function safeFingerprint(base64Key: string): string {
  try {
    return fingerprintOf(base64Key);
  } catch {
    return '(잘못된 키)';
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readEntries(path: string | null): Promise<KnownHostsEntry[]> {
  const text = path ? await readText(path) : null;
  return text === null ? [] : parseKnownHosts(text);
}
