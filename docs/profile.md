# `profile`

*WIP：这个机器人目前只支持群聊，本文档的内容可能会有大量改动*

一个 `profile` 保存了机器人在群聊中的「配置」和对应群聊的一些基本信息，
比如开启了哪些插件、哪些用户有管理员权限等等。

`profile` 应当保存在 `/profiles/<profile 名称>.json` 中。
但这并不是硬性要求，你也可以保存在其他任何地方，只要程序能够正确载入即可。

*WIP：在任何群聊中，使用**拥有管理员权限的帐号**向机器人[直接发送](/docs/message_format.md#直接消息) `"/start"` 
即可在该群聊中启用机器人。对应的 `profile` 也会被自动创建。*

`profile` 的结构大致如下：

```json
{
    "type": "group",
    "groups": [
        {
            "group_id": 123456789
        }
    ],
    "admins": [
        {
            "user_id": 123456,
            "only_in": [
                {
                    "group_id": 123456789
                }
            ]
        }
    ],
    "plugins": [
        {
            "name": "ping",
            "load_method": "import",
        }
    ]
}
```

## 群聊 `profile`

### `groups`

一个机器人可以同时在多个群组中工作，并且共享它们之间的数据。

`groups` 存放机器人工作的所有群组。只有这些群组中的事件会被传递给该 `profile` 的插件。

### `admins`

机器人的管理员列表。

这个管理员和群聊的管理员不同，群聊的管理员未必是机器人的管理员。

*WIP：通过 `/start` 命令启用机器人的用户会自动成为机器人的管理员。*

*WIP：管理员可以通过 `/grant @用户` 来让其他用户成为管理员*

### `plugins`

机器人的[插件](/docs/plugin_and_session.md)列表。

程序会在所有的插件加载完成后，再开始响应群聊中的消息。

*WIP：将 `profile` 运行时的数据存储在数据库中*

#### 插件的加载方式

##### `import`

在 `/plugins` 目录下寻找对应的插件。

通过 [JavaScript *dynamic import*](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import)
加载插件。