# IMBot

一个聊天机器人。

*WIP 还在施工中*

## 简介

这是一个基于 [go-cqhttp](https://github.com/Mrs4s/go-cqhttp) 的 QQ 聊天机器人。

使用了 [koishijs/node-gocqhttp](https://github.com/koishijs/node-gocqhttp) 来自动下载 go-cqhttp ，
所以你只需要执行 `npm install` 而无需另外下载单独的可执行文件。

给出了 `config.default.yml` 作为编写 `config.yml` 的参考。

这个程序使用[正向 WebSocket](https://12.onebot.dev/connect/communication/websocket/) 方式与 go-cqhttp 通信。