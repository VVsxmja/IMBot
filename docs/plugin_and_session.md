# 插件与 `session`

插件应当是一个对象，结构大致如下：

```javascript
export default {
    name: '',
    description: ''
    middleware: [
        {
            async match(event) {},
            pass: false, 
            async *action(event, context) {},
        },
    ],
    command: [
        {
            command: 'ping',
            async *action(args, context) {},
        }
    ]
}
```

`load_method` 为 `import` 的插件应当存放于 `/plugins/<插件名>/<插件名>.js` 中。

## `action()`

无论是中间件形式还是命令形式，都通过 `action()` 来响应事件。

`action()` 函数**必须要写成 [generator function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*)** ，
因为程序会将这个函数当作 generator function 调用。

函数执行时，可以通过 `yield` 等待响应一个[属于当前 `session`](#session-对事件的响应) 的事件。

- 由于 `session` 对事件的响应条件比较宽松（见 [`session` 对事件的响应](#session-对事件的响应)），被传递进来的事件并不一定满足原本 `middleware` 或 `command` 的匹配要求，甚至可能是一些随机内容。
- 如果 `yield` 到的事件不是你想要的，你可以选择再 `yield` 一个事件，也可以做其他处理，甚至直接退出。

## 中间件形式

与[命令形式](#命令形式)相比，中间件形式可以响应所有的事件，有更高的自由度。

一个插件可以有任意多个中间件。

### 属性

- `match(event)` : 用于判断一个事件是否要由该中间件处理。
  - 参数 `event` : 待匹配的事件。
- `pass` : 布尔值，表示该中间件处理完事件后，事件是否被传递给下一个中间件。若此项不存在或为 `false` ，则事件不会被传递。
- `action(event, context)` : 见上文。
  - 参数 `event` : 待响应的事件。
  - 参数 `context` : 上下文对象，包含当前 `profile` ，以及机器人自身

## 命令形式

与[中间件形式](#中间件形式)相比，命令形式可以让外部做更多的检查，
例如解析参数、判断是否有插件响应相同命令等等。

一个插件可以响应任意多条命令，但是不能与已有命令重复。

### 限制条件

插件被加载前，程序会检查已加载的插件和要加载的插件是否响应重复的命令，
如果是则插件不会被加载。

*WIP：插件不能响应程序自带的命令，例如 `/start` 等。*

### 属性

- `command` : 要响应的命令。
- `action(args, context)` : 见上文。
  - 参数 `args` : 调用该命令时传递的参数。
  - 参数 `context` : 上下文对象，包含当前 `profile` ，以及机器人自身

## `session`

`session` 是这个机器人的一个比较重要的概念，可以理解为「会话」，可以让插件实现一些交互式的操作。

当插件以任意形式响应了一个事件，程序就会创建一个新的 `session` 。

### `session` 对事件的响应

`session` 在插件**之前**响应事件。

只有用户在消息中**提及**了属于该 `session` 的消息，该消息事件才会被传递给该 `session` 。

*WIP：后续可能会添加其他的触发方式*

传递给某个 `session` 的事件不会被继续传递给其他 `session` 以及其他所有插件。

### 在会话中持久地保存数据

`session` 对象会保存会话的一些基本信息，例如「属于该会话的消息」等等。

`session` 中包含一个 [`action()`](#action) 的实例 `inst` ，它的 `this` 会指向该 `session` ,
你可以在 `session` 中保存一些你想要保存的数据，但你不应该更改任何由程序自动维护的数据。

更符合直觉的做法是使用 `action()` 的局部变量保存数据。

### `session` 的结束

当 `session` 过期，或者 `inst` 结束时，`session` 结束并被销毁。

*WIP：`session` 过期的判断还没实现*

### 其他

`session` 对象的结构大致如下：

```javascript
{
    context: [],
    inst: {}, // Generator object
}
```

- `context` : 数组，存放属于该 `session` 的全部事件。
- `inst` : [Generator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator) ，是 `action()` 的一个实例。