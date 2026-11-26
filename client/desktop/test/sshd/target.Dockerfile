# AC1~AC3 터미널 호환 테스트용: vim·bash·procps(top)를 추가한다.
FROM lscr.io/linuxserver/openssh-server:latest
RUN apk add --no-cache vim bash procps
