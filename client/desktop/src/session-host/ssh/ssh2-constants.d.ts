// ssh2(고정 버전)의 내부 상수 모듈. 타입 정의가 없어 쓰는 값만 선언한다(SEC-3 호스트 키 알고리즘 순서).
declare module 'ssh2/lib/protocol/constants.js' {
  const constants: {
    /** 런타임이 지원하는 호스트 키 알고리즘의 기본 순서(Ed25519는 런타임 지원 여부에 따라 들어간다) */
    DEFAULT_SERVER_HOST_KEY: string[];
  };
  export default constants;
}
