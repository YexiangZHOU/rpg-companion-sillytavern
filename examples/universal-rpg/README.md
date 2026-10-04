# 通用 RPG 交互原型

本地原型验证由模型输出定义创建游戏组别/字段，以及后续增量更新。修仙、飞船、经营、叙事按钮切换**合成模型输出**，不是正式游戏必须选择的预设。运行源码中的框架没有固定游戏分类、六属性或生命。

无依赖构建：

```sh
node examples/universal-rpg/build-preview.mjs /path/to/preview.html
```

直接浏览器打开生成的 HTML，不需要网络或服务。生成物不提交，维护源代码。可操作：对象切换、动态分组、数值/条目编辑、字段改名/摘要、组名/结构锁/数值锁、模型更新/新增分组、JSON协议初始化、拒绝非法更新、重复提交、历史分支与本地刷新保存。

模型 JSON 输入是唯一的合成生成接入点；没有真实 LLM 请求。协议解析/数据内核/渲染器是可复用源码，但尚未接入扩展生成事件、SillyTavern落盘、旧记录映射、骰子、遭遇或绘图。页面不会修改现有账号；浏览器存储键为 rpg_framework_synthetic_preview_v1。

```sh
node --test test/framework-state.test.mjs
```

首期支持 number/text/boolean/choice/resource/tags/collection；集合列支持非集合类型。暂不支持嵌套集合、计算表达式或任意自定义脚本。技术限额/版本号由框架维护，游戏范围和单位来自定义。
