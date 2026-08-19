const name = "dsh-livefeed";
const inject = ["timer", "web", "llm", "fs", "agentDefaultModel", "webServer"];
function apply(ctx) {
    // ══ 常量 ══
    const CONFIG_DIR = (() => {
      const env = (typeof process !== 'undefined' && process.env) ? process.env : null;
      if (env && env.DSH_LIVEFEED_DIR) return String(env.DSH_LIVEFEED_DIR).replace(/[\\/]+$/, '');
      const home = (env && (env.USERPROFILE || env.HOME)) || '.';
      return home + '/.dsh/dsh-livefeed';
    })();
    const CONFIG_FILE = CONFIG_DIR + '/config.json';
    const STATE_FILE = CONFIG_DIR + '/state.json';
    const HISTORY_FILE = CONFIG_DIR + '/history.jsonl';
    const TEMPLATE_FILE = CONFIG_DIR + '/sources/_template.js';
    const ROUTE_PATH = '/api/dsh-livefeed';
    const DEFAULT_INTERVAL_MIN = 30;
    const DEFAULT_FETCH_COUNT = 40;   // 拉取数量：单次从最新+最热门共拉取的话题数
    const DEFAULT_OUTPUT_COUNT = 8;   // 输出数量：AI 价值筛选后输出的卡片数
    const DEFAULT_RETENTION_DAYS = 3; // 已读卡片保留天数（过期卡片每次采集前清除）
    const CARD_BOUND = 300;           // 面板卡片内存上限（超出裁剪最老已读）
    const RETRY_MAX = 2;
    const RETRY_BASE_MS = 5 * 60 * 1000;
    const TICK_MS = 30 * 1000;        // 调度器基础节拍（实际周期由 config.intervalMinutes 决定）
    // 固定屏蔽标签：只屏蔽「富可敌国」话题（用户要求：仅此一个过滤）。
    // 命中口径：标签含「富可敌国」，或标题任意位置含「富可敌国」（直接子串匹配，无需括号）。
    // 其他标签/主题一概不在此过滤，交给 AI 价值筛选。
    const BLOCK_TAGS = ['富可敌国'];

    // ══ 基类模板 ══
    // 优先用运行目录 sources/_template.js（可覆盖定制）；
    // 缺失时回退内置常量 BUILTIN_TEMPLATE —— 由 scripts/build-lib.js 在构建时
    // 自动把 src/template/template.js 以 base64 内联（此处源码恒为空串）。
    const BUILTIN_TEMPLATE = atob('Lyog4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAqIGRzaC1saXZlZmVlZCDmkJzntKLmupDln7rnsbvmqKHmnb/vvIhCYXNlIFRlbXBsYXRl77yJCiAqIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAogKiBIb3N0IOWwhuacrOaooeadv+S4jua6kOiEmuacrOaLvOaOpe+8iHByb2dyYW0gPSDmqKHmnb8gKyAiXG4iICsg5rqQ6ISa5pys77yJ5ZCO77yM5L2c5Li6CiAqIGNvZGVSdW50aW1lIOeahCBwcm9ncmFtIOi/kOihjOOAgua6kOiEmuacrOWPqumcgOWunueOsO+8mgogKgogKiAgIGFzeW5jIGZ1bmN0aW9uIGNvYXJzZVNlYXJjaChhcGkpICAgLy8g5b+F6YCJ77ya57KX5pCc77yM6L+U5ZueIFt7dGl0bGUsIHVybCwgc25pcHBldD8sIHB1Ymxpc2hlZEF0PywgcmVwbHlDb3VudD8sIHZpZXdzPywgbGlrZXM/LCB0YWdzP31dCiAqICAgYXN5bmMgZnVuY3Rpb24gZmluZVNlYXJjaChhcGksIGl0ZW0pIC8vIOWPr+mAie+8mueyvuaQnO+8jOi/lOWbniB7IHRleHQgfe+8iOm7mOiupOWunueOsOingeS4i++8iQogKgogKiDmqKHmnb/lnKjmlofku7blsL7pg6jms6jlhaXosIPluqblmajvvIzkvp3mja4gYXBpLm1vZGUoKSDliIbmtL7vvJvlvZLkuIDljJYv5oiq5patL+WOu+mHjeeUseaooeadv+e7n+S4gOWujOaIkOOAggogKiDmupDohJrmnKzor7fli7/ph43mlrDlo7DmmI7nrKwgNCDoioLkv53nlZnlkI3vvIjop4EgZG9jcy9zb3VyY2UtY29udHJhY3QubWTvvInjgIIKICog5pys5paH5Lu25pivIEhvc3Qg5YaF572u5qih5p2/5bi46YeP55qE5rqQ5aS077ya5L+u5pS55ZCO6ZyA5ZCM5q2l5YiwIEhvc3Qg5Luj56CB5Lit55qE5qih5p2/5bi46YeP44CCCiAqLwondXNlIHN0cmljdCc7CgovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLy8g5bi46YePCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgApjb25zdCBNQVhfQ09OVEVOVF9DSEFSUyA9IDgwMDA7ICAgLy8g57K+5pCc5q2j5paH5LiK6ZmQ77yI5a2X56ym77yJCmNvbnN0IERFRkFVTFRfTUFYX0lURU1TID0gMTU7ICAgICAvLyDnspfmkJzpu5jorqTmnaHnm67kuIrpmZAKCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAovLyDlrZDnsbvlpZHnuqbvvJpjb2Fyc2VTZWFyY2gg5b+F6YCJ77yMZmluZVNlYXJjaCDlj6/pgInvvIjmnInpu5jorqTlrp7njrDvvIkKLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACmFzeW5jIGZ1bmN0aW9uIGNvYXJzZVNlYXJjaChhcGkpIHsKICAvLyDpu5jorqTnspfmkJzvvJrpgJrnlKggd2ViLnNlYXJjaCDlnovvvIjmupDohJrmnKzmnKrlrp7njrDkuJTmnKrphY3nva4gcXVlcnkg5pe25oqb6ZSZ5o+Q56S677yJCiAgY29uc3QgY2ZnID0gYXdhaXQgYXBpLmNvbmZpZyhudWxsKTsKICBjb25zdCBxID0gU3RyaW5nKChjZmcgJiYgY2ZnLnF1ZXJ5KSB8fCAnJykudHJpbSgpOwogIGlmICghcSkgewogICAgdGhyb3cgbmV3IEVycm9yKCdbZHNoLWxpdmVmZWVkXSDmnKrlrp7njrAgY29hcnNlU2VhcmNoIOS4lOa6kOacqumFjee9riBxdWVyeScpOwogIH0KICBjb25zdCByID0gYXdhaXQgc2VhcmNoV2ViKGFwaSwgcSwgKGNmZyAmJiBjZmcubWF4SXRlbXMpIHx8IERFRkFVTFRfTUFYX0lURU1TKTsKICByZXR1cm4gci5tYXAoKHMpID0+ICh7CiAgICB0aXRsZTogcy50aXRsZSB8fCBzLnVybCwKICAgIHVybDogcy51cmwsCiAgICBzbmlwcGV0OiBzLnNuaXBwZXQgfHwgJycsCiAgICBwdWJsaXNoZWRBdDogcy5wdWJsaXNoZWRBdCB8fCB1bmRlZmluZWQsCiAgfSkpOwp9Cgphc3luYyBmdW5jdGlvbiBmaW5lU2VhcmNoKGFwaSwgaXRlbSkgewogIC8vIOm7mOiupOeyvuaQnO+8muaKk+WPluadoeebriBVUkwg5bm25o+Q5Y+W5q2j5paH77yI57qv6ZO+5o6l5YiX6KGo5Z6L5rqQ5peg6ZyA6KaG55uW77yJCiAgY29uc3QgcGFnZSA9IGF3YWl0IGZldGNoUGFnZShhcGksIGl0ZW0udXJsKTsKICByZXR1cm4geyB0ZXh0OiBodG1sVG9UZXh0KHBhZ2UuYm9keS5jb250ZW50LCBNQVhfQ09OVEVOVF9DSEFSUykgfTsKfQoKLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACi8vIOWFrOWFseW3peWFt++8iOWfuuexu+aWueazle+8jOa6kOiEmuacrOWPr+ebtOaOpeiwg+eUqO+8iQovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLyoqIOWMheijhSBhcGkuc2VhcmNo77yM6L+U5ZueIHNvdXJjZXNbXSAqLwphc3luYyBmdW5jdGlvbiBzZWFyY2hXZWIoYXBpLCBxdWVyeSwgbWF4UmVzdWx0cykgewogIGNvbnN0IHIgPSBhd2FpdCBhcGkuc2VhcmNoKHsKICAgIHF1ZXJ5OiBTdHJpbmcocXVlcnkpLAogICAgbWF4UmVzdWx0czogbWF4UmVzdWx0cyB8fCBERUZBVUxUX01BWF9JVEVNUywKICB9KTsKICByZXR1cm4gKHIgJiYgQXJyYXkuaXNBcnJheShyLnNvdXJjZXMpID8gci5zb3VyY2VzIDogW10pOwp9CgovKiog5YyF6KOFIGFwaS5mZXRjaENvbnRlbnQgKi8KYXN5bmMgZnVuY3Rpb24gZmV0Y2hQYWdlKGFwaSwgdXJsKSB7CiAgcmV0dXJuIGFwaS5mZXRjaENvbnRlbnQoeyB1cmw6IFN0cmluZyh1cmwpIH0pOwp9CgovKiogSFRNTCDlrp7kvZPop6PnoIHvvIjlkKsgPGJyPiDmjaLooYzjgIHljrvmoIfnrb7jgIHmlbDlrZcv5Y2B5YWt6L+b5Yi25a6e5L2T5aaCICYjeDJGO++8iSAqLwpmdW5jdGlvbiBkZWNvZGVFbnRpdGllcyhzKSB7CiAgcmV0dXJuIFN0cmluZyhzKQogICAgLnJlcGxhY2UoLzxiclxzKlwvPz4vZ2ksICdcbicpCiAgICAucmVwbGFjZSgvPFtePl0rPi9nLCAnICcpCiAgICAucmVwbGFjZSgvJm5ic3A7L2dpLCAnICcpCiAgICAucmVwbGFjZSgvJmx0Oy9naSwgJzwnKQogICAgLnJlcGxhY2UoLyZndDsvZ2ksICc+JykKICAgIC5yZXBsYWNlKC8mcXVvdDsvZ2ksICciJykKICAgIC5yZXBsYWNlKC8mI3goWzAtOWEtZkEtRl0rKTsvZywgKG0sIGgpID0+IFN0cmluZy5mcm9tQ2hhckNvZGUocGFyc2VJbnQoaCwgMTYpKSkKICAgIC5yZXBsYWNlKC8mIyhcZCspOy9nLCAobSwgZCkgPT4gU3RyaW5nLmZyb21DaGFyQ29kZShOdW1iZXIoZCkpKQogICAgLnJlcGxhY2UoLyZhbXA7L2dpLCAnJicpOwp9CgovKiog6YCa55SoIEhUTUzihpLmlofmnKzvvJrljrvmoIfnrb7jgIHljovnvKnnqbrnmb3vvIzlj6/pgInmiKrmlq0gKi8KZnVuY3Rpb24gaHRtbFRvVGV4dChodG1sLCBtYXhMZW4pIHsKICBsZXQgdGV4dCA9IGRlY29kZUVudGl0aWVzKGh0bWwpCiAgICAucmVwbGFjZSgvWyBcdF0rL2csICcgJykKICAgIC5yZXBsYWNlKC9cbnszLH0vZywgJ1xuXG4nKQogICAgLnRyaW0oKTsKICBpZiAobWF4TGVuICYmIHRleHQubGVuZ3RoID4gbWF4TGVuKSB0ZXh0ID0gdGV4dC5zbGljZSgwLCBtYXhMZW4pICsgJ+KApic7CiAgcmV0dXJuIHRleHQ7Cn0KCi8qKiDlj5blgLzovoXliqnvvIjlrZfnrKbkuLLplK7miJblh73mlbDvvIkgKi8KZnVuY3Rpb24gcGljayhvYmosIGtleSkgewogIGlmIChrZXkgPT09IG51bGwgfHwga2V5ID09PSB1bmRlZmluZWQpIHJldHVybiAnJzsKICBpZiAodHlwZW9mIGtleSA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGtleShvYmopOwogIGNvbnN0IHYgPSBvYmpba2V5XTsKICByZXR1cm4gdiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQgPyAnJyA6IFN0cmluZyh2KTsKfQoKLyoqIOWwhiBKU09OIEFQSSDliJfooajop4TmlbTkuLogaXRlbXPvvJp7dGl0bGVLZXksIHVybEtleSwgc25pcHBldEtleT8sIHB1Ymxpc2hlZEF0S2V5PywgdXJsRmFsbGJhY2s/fSAqLwpmdW5jdGlvbiBqc29uSXRlbXMobGlzdCwgb3B0cykgewogIGNvbnN0IG8gPSBvcHRzIHx8IHt9OwogIHJldHVybiAoQXJyYXkuaXNBcnJheShsaXN0KSA/IGxpc3QgOiBbXSkubWFwKCh4KSA9PiAoewogICAgdGl0bGU6IHBpY2soeCwgby50aXRsZUtleSksCiAgICB1cmw6IHBpY2soeCwgby51cmxLZXkpIHx8ICh0eXBlb2Ygby51cmxGYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJyA/IHBpY2soeCwgby51cmxGYWxsYmFjaykgOiAnJyksCiAgICBzbmlwcGV0OiBvLnNuaXBwZXRLZXkgPyBwaWNrKHgsIG8uc25pcHBldEtleSkgOiAnJywKICAgIHB1Ymxpc2hlZEF0OiBvLnB1Ymxpc2hlZEF0S2V5ID8gcGljayh4LCBvLnB1Ymxpc2hlZEF0S2V5KSB8fCB1bmRlZmluZWQgOiB1bmRlZmluZWQsCiAgfSkpOwp9CgovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLy8g5b2S5LiA5YyW77yI5qih5p2/5YaF6YOo77yJCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgApmdW5jdGlvbiBfbm9ybWFsaXplVGl0bGVzKGl0ZW1zLCBjZmcpIHsKICBpZiAoIUFycmF5LmlzQXJyYXkoaXRlbXMpKSB7CiAgICB0aHJvdyBuZXcgRXJyb3IoJ1tkc2gtbGl2ZWZlZWRdIGNvYXJzZVNlYXJjaCDlv4Xpobvov5Tlm57mlbDnu4QnKTsKICB9CiAgY29uc3QgbWF4ID0gKGNmZyAmJiBjZmcubWF4SXRlbXMpIHx8IERFRkFVTFRfTUFYX0lURU1TOwogIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7CiAgY29uc3Qgb3V0ID0gW107CiAgZm9yIChjb25zdCBpdCBvZiBpdGVtcykgewogICAgaWYgKCFpdCB8fCB0eXBlb2YgaXQgIT09ICdvYmplY3QnKSBjb250aW51ZTsKICAgIGNvbnN0IHVybCA9IFN0cmluZyhpdC51cmwgfHwgJycpLnRyaW0oKTsKICAgIGNvbnN0IHRpdGxlID0gU3RyaW5nKGl0LnRpdGxlIHx8ICcnKS50cmltKCk7CiAgICBpZiAoIXVybCB8fCAhdGl0bGUgfHwgc2Vlbi5oYXModXJsKSkgY29udGludWU7CiAgICBzZWVuLmFkZCh1cmwpOwogICAgb3V0LnB1c2goewogICAgICB0aXRsZSwKICAgICAgdXJsLAogICAgICBzbmlwcGV0OiBpdC5zbmlwcGV0ID8gU3RyaW5nKGl0LnNuaXBwZXQpLnNsaWNlKDAsIDUwMCkgOiAnJywKICAgICAgcHVibGlzaGVkQXQ6IHR5cGVvZiBpdC5wdWJsaXNoZWRBdCA9PT0gJ3N0cmluZycgPyBpdC5wdWJsaXNoZWRBdCA6IHVuZGVmaW5lZCwKICAgICAgLy8g6ZmE5Yqg5a2X5q6177yI5rqQ6ISa5pys5Y+v5pC65bim77yM5L6bIEhvc3Qg55qEIEFJIOS7t+WAvOetm+mAieS9v+eUqO+8m+e8uuWkseaXtuWuieWFqOWbnumAgO+8iQogICAgICByZXBseUNvdW50OiBOdW1iZXIoaXQucmVwbHlDb3VudCkgfHwgMCwKICAgICAgcG9zdHNDb3VudDogTnVtYmVyKGl0LnBvc3RzQ291bnQpIHx8IDAsCiAgICAgIHZpZXdzOiBOdW1iZXIoaXQudmlld3MpIHx8IDAsCiAgICAgIGxpa2VzOiBOdW1iZXIoaXQubGlrZXMpIHx8IDAsCiAgICAgIHRhZ3M6IEFycmF5LmlzQXJyYXkoaXQudGFncykgPyBpdC50YWdzLm1hcChTdHJpbmcpIDogW10sCiAgICB9KTsKICAgIGlmIChvdXQubGVuZ3RoID49IG1heCkgYnJlYWs7CiAgfQogIHJldHVybiBvdXQ7Cn0KCmZ1bmN0aW9uIF9ub3JtYWxpemVDb250ZW50KG91dCkgewogIGlmICghb3V0IHx8IHR5cGVvZiBvdXQgIT09ICdvYmplY3QnKSB7CiAgICB0aHJvdyBuZXcgRXJyb3IoJ1tkc2gtbGl2ZWZlZWRdIGZpbmVTZWFyY2gg5b+F6aG76L+U5ZueIHsgdGV4dCB9Jyk7CiAgfQogIGNvbnN0IHRleHQgPSBTdHJpbmcob3V0LnRleHQgfHwgJycpLnRyaW0oKTsKICBpZiAoIXRleHQpIHRocm93IG5ldyBFcnJvcignW2RzaC1saXZlZmVlZF0gZmluZVNlYXJjaCDov5Tlm57nmoTmraPmlofkuLrnqbonKTsKICByZXR1cm4geyB0ZXh0OiB0ZXh0LnNsaWNlKDAsIE1BWF9DT05URU5UX0NIQVJTKSB9Owp9CgovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLy8g6LCD5bqm5Zmo77yI5qih5p2/5YaF572u77yb5rqQ6ISa5pys5peg6ZyA5YWz5b+D77yJCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAphc3luYyBmdW5jdGlvbiBfZHNoTGl2ZWZlZWREaXNwYXRjaGVyKCkgewogIGNvbnN0IG1vZGUgPSBhd2FpdCBhcGkubW9kZShudWxsKTsKICBpZiAobW9kZSA9PT0gJ3RpdGxlcycpIHsKICAgIHJldHVybiBfbm9ybWFsaXplVGl0bGVzKGF3YWl0IGNvYXJzZVNlYXJjaChhcGkpLCBhd2FpdCBhcGkuY29uZmlnKG51bGwpKTsKICB9CiAgaWYgKG1vZGUgPT09ICdjb250ZW50JykgewogICAgY29uc3QgaXRlbSA9IGF3YWl0IGFwaS5pdGVtKG51bGwpOwogICAgcmV0dXJuIF9ub3JtYWxpemVDb250ZW50KGF3YWl0IGZpbmVTZWFyY2goYXBpLCBpdGVtKSk7CiAgfQogIHRocm93IG5ldyBFcnJvcignW2RzaC1saXZlZmVlZF0g5pyq55+l5qih5byPOiAnICsgU3RyaW5nKG1vZGUpKTsKfQoKcmV0dXJuIGF3YWl0IF9kc2hMaXZlZmVlZERpc3BhdGNoZXIoKTsK');

    // ══ 运行时状态（进程内存）══
    const state = {
      config: null,          // 当前配置（加载失败时用内置默认）
      cards: [],             // 面板卡片（未读 + 有界已读）
      seenUrls: new Set(),   // 持久去重集合（启动装载，周期追加）
      archive: [],           // history.jsonl 内存镜像（有界，去重依据）
      sourceErrors: [],      // 本周期源错误
      cycleStats: null,      // {scanned, selected, filtered}
      progress: null,        // {stage, detail, ts} 当前管线阶段（面板进度显示）
      running: false,
      paused: false,
      retrying: 0,
      lastRunAt: undefined,
      lastError: undefined,
      tick: 0,
      mid: 0,                // 消息 id 计数器
      cycleStamp: null,      // 当前刷新周期时间戳（卡片按它分组折叠）
    };
    let disposed = false;

    // ══ fs 工具 ══
    async function fsRead(absPath) {
      try {
        const target = await ctx.fs.resolve(absPath);
        return await ctx.fs.readText(target);
      } catch (_) {
        return null;
      }
    }
    async function fsWrite(absPath, content) {
      try {
        const target = await ctx.fs.resolve(absPath);
        await ctx.fs.writeText(target, content);
        return true;
      } catch (err) {
        console.error('[dsh-livefeed] write failed:', absPath, String(err && err.message || err));
        return false;
      }
    }
    function parseJson(text, fallback) {
      try {
        return text ? JSON.parse(text) : fallback;
      } catch (_) {
        return fallback;
      }
    }
    // RPC 返回必须是无损 JSON：递归把 undefined 归一为 null（Date 等非常规对象不会出现在载荷中）
    function jsonSafe(v) {
      if (v === undefined) return null;
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(jsonSafe);
      const out = {};
      for (const k of Object.keys(v)) out[k] = jsonSafe(v[k]);
      return out;
    }

    // ══ 默认值 ══
    function defaultConfig() {
      return {
        intervalMinutes: DEFAULT_INTERVAL_MIN,
        fetchCount: DEFAULT_FETCH_COUNT,
        outputCount: DEFAULT_OUTPUT_COUNT,
        retentionDays: DEFAULT_RETENTION_DAYS, // 已读卡片保留天数
        summaryLanguage: 'zh-CN',
        model: null,
        sources: [],
      };
    }
    function mergeConfig(base, cfg) {
      if (!cfg || typeof cfg !== 'object') return base;
      const out = {};
      for (const k of Object.keys(base)) out[k] = cfg[k] !== undefined ? cfg[k] : base[k];
      if (!Array.isArray(out.sources)) out.sources = [];
      return out;
    }
    // 固定源：Linux Do（config.json 中 id=linuxdo 的条目；缺省用内置默认）
    function linuxdoSource(cfg) {
      const list = (cfg && Array.isArray(cfg.sources)) ? cfg.sources : [];
      const found = list.find((s) => s && String(s.id) === 'linuxdo');
      return Object.assign({
        id: 'linuxdo',
        name: 'Linux Do',
        script: 'sources/linuxdo.js',
        query: '',
        enabled: true,
        fetch: 'browser',
        maxItems: 200,
      }, found || {});
    }

    // ══ URL 归一化（正则实现）══
    function normalizeUrl(raw) {
      let s = String(raw || '').trim();
      if (!s) return s;
      s = s.split('#')[0].replace(/\/+$/, '');
      const m = s.match(/^https?:\/\/([^\/]+)(.*)$/i);
      if (m) s = 'http://' + m[1].toLowerCase() + m[2];
      return s;
    }

    // ══ 模型调用（llm.stream + 手工构造消息）══
    function resolveModel() {
      const cfgModel = state.config && state.config.model;
      if (cfgModel && cfgModel.provider && cfgModel.model) {
        return { provider: cfgModel.provider, model: cfgModel.model, reasoningEffort: cfgModel.reasoningEffort };
      }
      const sel = ctx.agentDefaultModel.currentSelection();
      return { provider: sel.provider, model: sel.model, reasoningEffort: sel.reasoningEffort };
    }
    async function callModel(system, userText, maxTokens) {
      const sel = resolveModel();
      const opts = {
        provider: sel.provider,
        model: sel.model,
        system: system || '',
        maxTokens: maxTokens || 3000,
        messages: [{
          id: 'dsh-livefeed-' + (++state.mid),
          role: 'user',
          content: [{ type: 'text', text: userText }],
          source: { kind: 'user' },
        }],
      };
      if (sel.reasoningEffort) opts.reasoningEffort = sel.reasoningEffort;
      let text = '';
      let failure = null;
      try {
        for await (const ch of ctx.llm.stream(opts)) {
          if (ch.type === 'text-delta') text += ch.text;
          else if (ch.type === 'finish' && (ch.reason.kind === 'error' || ch.reason.kind === 'aborted')) {
            failure = (ch.reason.failure && ch.reason.failure.message) || ch.reason.kind;
          }
        }
      } catch (err) {
        failure = String((err && err.message) || err);
      }
      if (failure) throw new Error('模型调用失败: ' + failure);
      return text;
    }

    // 容错 JSON 提取（首个平衡 {…}）
    function extractJson(text) {
      const s = String(text || '');
      const start = s.indexOf('{');
      if (start < 0) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { return null; }
          }
        }
      }
      return null;
    }
    // 容错 JSON 数组提取（首个平衡 […]）
    function extractJsonArr(text) {
      const s = String(text || '');
      const start = s.indexOf('[');
      if (start < 0) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { return null; }
          }
        }
      }
      return null;
    }

    // ══ 正文抓取：web.fetch → Node fetch → curl 回退（逐层收集失败原因，便于排查网络/代理问题）══
    function errMsg(e) {
      const m = String((e && e.message) || e || '');
      const code = (e && e.cause && e.cause.code) || '';
      return code ? m + ' (' + code + ')' : m;
    }
    async function fetchContentImpl(url, opts) {
      if (opts && opts.viaBrowser) {
        try {
          return await fetchViaBrowser(String(url));
        } catch (err) {
          throw new Error('浏览器抓取失败 ' + String(url) + '（' + errMsg(err) + '）');
        }
      }
      const reasons = [];
      const proxyEnv = (typeof process !== 'undefined' && process.env)
        && (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy);
      if (proxyEnv) {
        try {
          return await fetchViaCurl(String(url));
        } catch (err) {
          reasons.push('curl: ' + errMsg(err));
        }
        throw new Error('抓取失败 ' + String(url) + '（' + reasons.join('；') + '）');
      }
      try {
        const r = await ctx.web.fetch({ url: String(url) });
        return { url: r.url, statusCode: r.statusCode, body: r.body, truncated: !!r.truncated };
      } catch (err) {
        reasons.push('web.fetch: ' + errMsg(err));
      }
      try {
        return await fetchViaNode(String(url));
      } catch (err) {
        reasons.push('node fetch: ' + errMsg(err));
      }
      try {
        return await fetchViaCurl(String(url));
      } catch (err) {
        reasons.push('curl: ' + errMsg(err));
      }
      throw new Error('抓取失败 ' + String(url) + '（' + reasons.join('；') + '）');
    }
    async function fetchViaNode(url) {
      if (typeof fetch !== 'function') throw new Error('Node fetch 不可用');
      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(20000),
            headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-livefeed/1.0)' },
          });
          let text = await res.text();
          let truncated = false;
          if (text.length > 1200000) { text = text.slice(0, 1200000); truncated = true; }
          const lower = text.slice(0, 2000).toLowerCase();
          const kind = /<html|<head|<body/i.test(lower) ? 'html' : 'text';
          return { url: String(url), statusCode: res.status, body: { kind, content: text }, truncated };
        } catch (err) {
          lastErr = err;
          const code = (err && err.cause && err.cause.code) || '';
          console.warn('[dsh-livefeed] node fetch attempt ' + attempt + '/2 failed:', String(url), code || String((err && err.message) || err));
        }
      }
      const code = (lastErr && lastErr.cause && lastErr.cause.code) || '';
      throw new Error(code ? code + '（直连失败，请检查网络/代理）' : String((lastErr && lastErr.message) || lastErr));
    }
    async function fetchViaCurl(url) {
      const shell = ctx.get('shell');
      if (shell === undefined) throw new Error('web.fetch 与 shell 均不可用');
      const safeUrl = String(url).replace(/"/g, '%22');
      const spec = shell.resolve({
        command: 'curl.exe -sL --max-time 20 --compressed -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36" "' + safeUrl + '"',
        timeoutMs: 30000,
        stdoutMaxBytes: 1200000,
        sandboxPolicy: {
          mode: 'danger-full-access',
          workspaceRoot: (typeof process !== 'undefined' && process.cwd && process.cwd()) || CONFIG_DIR,
        },
      });
      const res = await shell.run(spec);
      if (res.exitCode !== 0) {
        const stderr = ((res.stderr && res.stderr.text) || '').slice(0, 300);
        throw new Error('curl 失败 exit=' + res.exitCode + (stderr ? ' (' + stderr.trim() + ')' : ''));
      }
      const text = (res.stdout && res.stdout.text) || '';
      if (!text) throw new Error('curl 返回空内容');
      const lower = text.slice(0, 2000).toLowerCase();
      const kind = /<html|<head|<body/i.test(lower) ? 'html' : 'text';
      return { url: String(url), statusCode: 200, body: { kind, content: text }, truncated: !!(res.stdout && res.stdout.truncated) };
    }

    // ══ 浏览器抓取：playwright-core + 系统 Edge（有头离屏窗口）══
    // 背景：linux.do 位于 Cloudflare 托管质询之后 —— web.fetch/node fetch/curl 一律 403
    // 「Just a moment…」，无头浏览器被识别且质询永不解开；实测有头（离屏）直接放行。
    // 源级配置 fetch:"browser" 启用；浏览器走系统代理（不硬编码代理地址）。
    const BROWSER_PROFILE_DIR = CONFIG_DIR + '/edge-profile';
    const BROWSER_IDLE_MS = 90 * 1000;
    const browserSession = { ctx: null, page: null, starting: null, idleStop: null };
    function browserLog(...a) { console.log('[dsh-livefeed][browser]', ...a); }
    async function closeBrowserSession() {
      const s = browserSession;
      if (s.idleStop) { try { s.idleStop(); } catch (_) { /* ignore */ } s.idleStop = null; }
      const c = s.ctx;
      s.ctx = null; s.page = null; s.starting = null;
      if (c) { try { await c.close(); } catch (_) { /* ignore */ } }
    }
    function touchBrowserSession() {
      const s = browserSession;
      if (s.idleStop) { try { s.idleStop(); } catch (_) { /* ignore */ } s.idleStop = null; }
      if (!s.ctx) return;
      s.idleStop = ctx.timeout(async () => {
        s.idleStop = null;
        if (s.ctx) { browserLog('idle close'); await closeBrowserSession(); }
      }, BROWSER_IDLE_MS);
    }
    async function getBrowserPage() {
      const s = browserSession;
      if (s.page && !s.page.isClosed()) { touchBrowserSession(); return s.page; }
      await closeBrowserSession();
      if (s.starting) return s.starting;
      s.starting = (async () => {
        let pw = null;
        try { pw = await import('playwright-core'); }
        catch (_) { throw new Error('playwright-core 未安装（git 安装会自动携带依赖）'); }
        let lastErr = null;
        for (const channel of ['msedge', 'chrome']) {
          try {
            const c = await pw.chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
              channel,
              headless: false,
              args: ['--no-first-run', '--disable-gpu', '--window-position=-32000,-32000', '--window-size=1280,800'],
              viewport: { width: 1280, height: 800 },
              locale: 'zh-CN',
            });
            s.ctx = c;
            s.page = c.pages()[0] || (await c.newPage());
            browserLog('launched channel=' + channel);
            touchBrowserSession();
            return s.page;
          } catch (err) { lastErr = err; }
        }
        throw new Error('浏览器启动失败（msedge/chrome）：' + String((lastErr && lastErr.message) || lastErr).split('\n')[0]);
      })().finally(() => { s.starting = null; });
      return s.starting;
    }
    async function resetBrowserProfile() {
      await closeBrowserSession();
      await new Promise((r) => { try { ctx.timeout(r, 1500); } catch (_) { r(); } });
      const shell = ctx.get('shell');
      if (shell === undefined) { browserLog('shell 不可用，无法重置档案'); return; }
      try {
        const spec = shell.resolve({
          command: 'cmd /c if exist "' + BROWSER_PROFILE_DIR + '" rd /s /q "' + BROWSER_PROFILE_DIR + '"',
          timeoutMs: 30000,
          stdoutMaxBytes: 10000,
          sandboxPolicy: { mode: 'danger-full-access' },
        });
        await shell.run(spec);
        browserLog('档案已重置（下次启动自动重建全新 Edge profile）');
      } catch (err) {
        console.error('[dsh-livefeed] 档案重置失败:', String((err && err.message) || err));
      }
    }
    async function fetchViaBrowser(url) {
      let page;
      try {
        page = await getBrowserPage();
      } catch (err) {
        await closeBrowserSession();
        page = await getBrowserPage();
      }
      touchBrowserSession();
      const chalText = (s) => s.indexOf('请稍候') >= 0 || s.indexOf('Just a moment') >= 0 || s.indexOf('cf-chl') >= 0;
      const readState = async () => ({
        text: await page.evaluate(() => (document.body && document.body.innerText) || '').catch(() => ''),
        title: await page.title().catch(() => ''),
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await page.goto(String(url), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => { /* 慢加载也继续取内容 */ });
          let st = await readState();
          for (let i = 0; i < 4 && (chalText(st.text) || chalText(st.title)); i++) {
            await page.waitForTimeout(5000).catch(() => { /* ignore */ });
            st = await readState();
          }
          if (chalText(st.text) || chalText(st.title)) {
            browserLog('CF 质询未通过，重置浏览器档案后重试');
            await resetBrowserProfile();
            page = await getBrowserPage();
            touchBrowserSession();
            continue;
          }
          let t = String(st.text || '').trim();
          if (t && t[0] !== '{' && t[0] !== '[') {
            const html = await page.content().catch(() => '');
            const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
            if (m) t = m[1].trim();
          }
          if (!t) throw new Error('浏览器抓取内容为空');
          let truncated = false;
          if (t.length > 1200000) { t = t.slice(0, 1200000); truncated = true; }
          return { url: String(url), statusCode: 200, body: { kind: 'text', content: t }, truncated };
        } catch (err) {
          if (attempt === 1) throw err;
          browserLog('抓取异常，重置浏览器档案后重试: ' + String((err && err.message) || err).split('\n')[0]);
          await resetBrowserProfile();
          page = await getBrowserPage();
          touchBrowserSession();
        }
      }
      throw new Error('浏览器抓取失败 ' + String(url));
    }

    // ══ 源脚本执行（codeRuntime；缺失时报错并跳过该源）══
    function buildProgram(template, script) {
      return template + '\n' + (script || '');
    }
    async function loadTemplateAndScript(source) {
      let template = BUILTIN_TEMPLATE;
      const custom = await fsRead(TEMPLATE_FILE);
      if (custom && custom.indexOf('_dshLivefeedDispatcher') >= 0) template = custom;
      else if (custom) console.error('[dsh-livefeed] sources/_template.js 缺少调度器标记，回退内置模板');
      if (!template) throw new Error('基类模板缺失：请确认运行目录存在 sources/_template.js');
      let script = '';
      if (source && source.script) {
        const abs = CONFIG_DIR + '/' + String(source.script);
        const sp = await fsRead(abs);
        if (sp === null) throw new Error('源脚本不存在: ' + source.script);
        script = sp;
      }
      return buildProgram(template, script);
    }
    async function runSourceScript(program, args) {
      const codeRuntime = ctx.get('codeRuntime');
      if (codeRuntime === undefined) throw new Error('codeRuntime 服务不可用：无法执行源脚本');
      const bindings = [{
        global: 'api',
        functions: {
          mode: async () => args.mode,
          config: async () => (args.config || {}),
          item: async () => (args.item || null),
          search: async (a) => {
            const req = a || {};
            return ctx.web.search({ query: String(req.query || ''), maxResults: req.maxResults });
          },
          fetchContent: async (a) => fetchContentImpl((a || {}).url, {
            viaBrowser: !!(args.config && args.config.fetch === 'browser'),
          }),
          // 已读/已采集 URL 集合（源脚本据此跳过重复话题，不重复拉取）
          seenUrls: async () => Array.from(state.seenUrls),
        },
      }];
      const run = await codeRuntime.run({ program, bindings });
      if (run.error) throw new Error('脚本执行失败: ' + run.error.message);
      return run.value;
    }

    // ══ 管线阶段 ══
    // 1. 粗搜：从最新 + 最热门拉取话题（linuxdo 源，模板按 maxItems 合并截断）
    async function stageCoarse(source) {
      const program = await loadTemplateAndScript(source);
      // 目标 = 拉取数量（fetchCount）：源脚本从最新+最热门共收集这么多条「新」话题
      const cap = Math.max(1, Number(state.config.fetchCount) || DEFAULT_FETCH_COUNT);
      const effective = Object.assign({}, source, {
        maxItems: cap,
        blockTags: BLOCK_TAGS,
      });
      const items = await runSourceScript(program, { mode: 'titles', config: effective });
      return Array.isArray(items) ? items : [];
    }

    // 固定屏蔽：标签含「富可敌国」或标题含「富可敌国」即屏蔽；其余一概不在此过滤
    function isBlockedTopic(it) {
      const title = String((it && it.title) || '');
      const tags = Array.isArray(it && it.tags) ? it.tags.map(String) : [];
      return BLOCK_TAGS.some((t) => tags.indexOf(t) >= 0 || title.indexOf(t) >= 0);
    }

    // 2. 拉取时去重：按已读 URL（seenUrls）跳过重复；命中固定屏蔽标签跳过；
    //    新话题总数不超过 fetchCount（拉取数量）。
    async function pullFresh(items) {
      const cap = Math.max(1, Number(state.config.fetchCount) || DEFAULT_FETCH_COUNT);
      const out = [];
      for (const it of items) {
        if (out.length >= cap) break;
        const key = normalizeUrl(it && it.url);
        if (!key || state.seenUrls.has(key)) continue;  // 已读/已采集 → 不重复拉取
        if (isBlockedTopic(it)) continue;              // 【富可敌国】标签 → 屏蔽
        out.push(it);
      }
      return out;
    }

    // 确定性价值分（AI 失败/补齐时用）：回复数为主，浏览量、点赞为辅
    function valueScore(it) {
      const r = Number(it.replyCount) || 0;
      const v = Number(it.views) || 0;
      const l = Number(it.likes) || 0;
      return r * 4 + v / 60 + l * 2;
    }

    // 3. AI 价值筛选：只判断话题价值（回复数/浏览量/内容质量等），不按主题/关键词；
    //    输出数量贴近 outputCount；拉取数量 ≤ 输出数量时跳过 AI 过滤。
    async function stageJudge(items) {
      const cap = Math.max(1, Number(state.config.outputCount) || DEFAULT_OUTPUT_COUNT);
      if (!items.length) return [];
      if (items.length <= cap) return items;  // 拉取数量 ≤ 有效数量：不经 AI 过滤
      const list = items.map((it, i) => ({
        i,
        title: String(it.title || ''),
        url: String(it.url || ''),
        snippet: String(it.snippet || '').slice(0, 200),
        replyCount: Number(it.replyCount) || 0,
        views: Number(it.views) || 0,
        likes: Number(it.likes) || 0,
        tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
      }));
      const system =
        '你是话题价值筛选助手。以下是 Linux Do 论坛新拉取的话题列表，请按「价值」选出最有价值的 N 条。' +
        '判断价值时综合考量：回复数与讨论热度（回复越多通常越有价值）、浏览量/点赞数（受关注程度）、' +
        '话题内容是否有质量（是否具体、信息量足、对读者有实际帮助）、时效性与新鲜度，' +
        '并避开垃圾/纯推广/无实质内容的话题——纯广告/福利推广类帖子即使回复数很高也不算价值。' +
        '注意：不要根据话题的主题、标题关键词或标签过滤——任何主题的话题都可能是高价值的；只判断话题本身的价值。' +
        '输出条数应尽量接近 N（列表长度足够时恰好输出 N 条），并按价值从高到低排序。' +
        '\nN = ' + cap +
        '\n只输出 JSON: {"selected":[{"index":0,"reason":"一句话理由"}]}。';
      let parsed = null;
      const budgets = [4000, 6000, 8000];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const raw = await callModel(system, JSON.stringify(list, null, 1), budgets[attempt - 1]);
          parsed = extractJson(raw);
          if (parsed && Array.isArray(parsed.selected)) break;
        } catch (err) {
          console.warn('[dsh-livefeed] judge call failed:', String((err && err.message) || err));
        }
        if (attempt < 3) console.warn('[dsh-livefeed] judge parse failed, retry', attempt + '/3');
      }
      const picked = [];
      const used = new Set();
      if (parsed && Array.isArray(parsed.selected)) {
        for (const s of parsed.selected) {
          const idx = Number(s && s.index);
          if (Number.isInteger(idx) && idx >= 0 && idx < items.length && !used.has(idx)) {
            used.add(idx);
            picked.push(items[idx]);
          }
          if (picked.length >= cap) break;
        }
      }
      // AI 未选满（或调用失败）时按确定性价值分补齐，保证输出数量贴近预设
      if (picked.length < cap) {
        const rest = items
          .map((it, i) => ({ it, i, s: valueScore(it) }))
          .filter((x) => !used.has(x.i))
          .sort((a, b) => b.s - a.s);
        for (const x of rest) {
          if (picked.length >= cap) break;
          picked.push(x.it);
        }
      }
      return picked;
    }

    // 安全验证页/反爬拦截页识别：这类页面文本非空但内容无效，
    // 命中后视为「正文为空」→ 卡片直接丢弃（不生成拦截提示类摘要）
    function isBlockPage(text) {
      const t = String(text || '').toLowerCase();
      const strong = [
        'attention required', 'checking your browser', 'verify you are human',
        'enable javascript and cookies', 'just a moment', 'access denied',
        'you have been blocked', 'cf-chl', 'captcha', 'puzzle',
        'your current connection has been blocked', 'we have detected unusual activity',
        '异常活动', '安全系统阻止', '检测到异常', '安全验证',
      ];
      for (const m of strong) if (t.indexOf(m) >= 0) return true;
      const weak = ['cloudflare', 'akamai', 'security check', 'bot', 'challenge', 'reference number', 'permission', 'blocked', '被阻止', '安全系统'];
      let w = 0;
      if (t.length < 12000) {
        for (const m of weak) if (t.indexOf(m) >= 0) w++;
      }
      return w >= 2;
    }

    const SUMMARIZE_INPUT_BUDGET = 30000; // 单次摘要调用的总输入预算（字符，≈15k tokens 内）

    // 4. 单话题精搜：抓正文（网络请求，非模型调用）；无正文且无片段时返回 null（该话题丢弃）
    async function fetchItemContent(item, source) {
      let content = null;
      try {
        const program = await loadTemplateAndScript(source);
        const out = await runSourceScript(program, { mode: 'content', config: source, item });
        if (out && out.text) {
          if (isBlockPage(out.text)) {
            console.log('[dsh-livefeed] block-page content skipped:', item.url);
            content = null;
          } else {
            content = out.text;
          }
        }
      } catch (err) {
        console.error('[dsh-livefeed] fineSearch failed:', String(err && err.message || err));
      }
      const snippet = String(item.snippet || '');
      const fallbackText = content || snippet;
      // 正文抓取失败也照常落卡（摘要用占位文案），保证输出数量贴近预设 outputCount
      return { item, source, content, fallbackText, sourceText: (content || snippet).slice(0, 6000) };
    }

    // 5. 批量摘要：全部条目合并为一次模型调用；单条失败不影响其余
    async function stageSummarize(entries) {
      const lang = state.config.summaryLanguage || 'zh-CN';
      const cards = [];
      if (!entries.length) return cards;
      const sourceName = (entries[0].source && entries[0].source.name) || 'Linux Do';
      state.progress = { stage: 'fine', detail: sourceName, ts: Date.now() };
      const perItem = Math.max(800, Math.min(6000, Math.floor(SUMMARIZE_INPUT_BUDGET / entries.length)));
      const results = new Array(entries.length).fill(null);
      try {
        const system =
          '你是资讯摘要助手。以下内容来自「' + sourceName + '」。对每条内容生成「' + lang + '」标题与 2-3 句摘要。' +
          '标题必须翻译成「' + lang + '」（专有名词/产品名/品牌名可保留原文）。只输出 JSON 数组，顺序对应输入，' +
          '每条都必须包含 index/title/summary：[{"index":0,"title":"…","summary":"…"}]';
        const input = JSON.stringify(entries.map((e, i) => ({ index: i, title: e.item.title, content: e.sourceText.slice(0, perItem) })));
        const raw = await callModel(system, input, Math.min(12000, 2000 + entries.length * 400));
        const parsed = extractJsonArr(raw);
        if (Array.isArray(parsed)) {
          for (const p of parsed) {
            if (!p || typeof p.index !== 'number' || !Number.isInteger(p.index) || p.index < 0 || p.index >= entries.length) continue;
            if (p.title && p.summary) results[p.index] = { title: String(p.title), summary: String(p.summary) };
          }
        }
      } catch (err) {
        console.error('[dsh-livefeed] summarize failed:', String((err && err.message) || err));
      }
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const r = results[i];
        cards.push({
          title: r ? r.title : e.item.title,
          summary: r ? r.summary : (e.fallbackText ? e.fallbackText.slice(0, 300) : '（正文抓取失败，点击卡片查看原文）'),
          url: e.item.url,
          sourceName: e.source.name,
          publishedAt: e.item.publishedAt,
        });
      }
      return cards;
    }

    // 6. 落卡：URL 去重（安全网）→ 未读卡片 → 归档
    async function stageLand(cards) {
      const newCards = [];
      for (const card of cards) {
        if (!card || !card.url) continue;
        const key = normalizeUrl(card.url);
        if (state.seenUrls.has(key)) continue;
        state.seenUrls.add(key);
        const full = {
          id: 'c' + state.tick + '-' + newCards.length + '-' + Math.random().toString(36).slice(2, 8),
          title: card.title,
          summary: card.summary,
          url: card.url,
          sourceName: card.sourceName || '',
          publishedAt: card.publishedAt,
          read: false,
          isNew: true,
          createdAt: Date.now(),
          cycle: state.cycleStamp || null,
        };
        newCards.push(full);
        state.cards.push(full);
      }
      // 有界：优先裁剪最老的已读卡片；已读不足时裁剪最老卡片（含未读），
      // 保证内存与 saveState 的 slice(-CARD_BOUND) 口径一致（不丢弃最新卡片）
      if (state.cards.length > CARD_BOUND) {
        const removable = state.cards.filter((c) => c.read);
        let over = state.cards.length - CARD_BOUND;
        for (const rc of removable) {
          if (over <= 0) break;
          const idx = state.cards.indexOf(rc);
          if (idx >= 0) { state.cards.splice(idx, 1); over--; }
        }
        if (state.cards.length > CARD_BOUND) {
          state.cards.splice(0, state.cards.length - CARD_BOUND);
        }
      }
      // 归档（有界滚动，历史去重依据）
      for (const c of newCards) {
        state.archive.push({ id: c.id, title: c.title, url: c.url, summary: c.summary, sourceName: c.sourceName, publishedAt: c.publishedAt, createdAt: c.createdAt });
      }
      await saveArchive();
      return newCards;
    }

    // ══ 持久化 ══
    async function saveState() {
      // 持久化全部卡片（未读 + 有界已读，内存已按 CARD_BOUND 裁剪），已读 tab 跨周期/重启保留
      await fsWrite(STATE_FILE, JSON.stringify({
        cards: state.cards.slice(-CARD_BOUND),
        lastRunAt: state.lastRunAt,
      }, null, 2));
    }
    async function saveConfig() {
      await fsWrite(CONFIG_FILE, JSON.stringify(state.config, null, 2));
    }
    async function saveArchive() {
      const max = 5000;
      if (state.archive.length > max) state.archive = state.archive.slice(-max);
      await fsWrite(HISTORY_FILE, state.archive.map((x) => JSON.stringify(x)).join('\n'));
    }

    // ══ 已读卡片过期清理 ══
    function retentionMs() {
      const d = Number(state.config && state.config.retentionDays) || DEFAULT_RETENTION_DAYS;
      return Math.max(1, d) * 24 * 60 * 60 * 1000;
    }
    // 清除过期的已读卡片（每次采集前调用）：未读卡片不清除（等待阅读，由 CARD_BOUND 兜底）；
    // 已读卡片按 readAt（兼容旧数据回退 createdAt）保留 retentionDays 天。
    // 已清除卡片的 URL 仍留在 history.jsonl 的 seenUrls 中，不会重复采集。
    function purgeExpiredCards() {
      const cutoff = Date.now() - retentionMs();
      const before = state.cards.length;
      state.cards = state.cards.filter((c) => {
        if (!c.read) return true;
        const ageBase = Number(c.readAt || c.createdAt) || 0;
        return ageBase >= cutoff;
      });
      const purged = before - state.cards.length;
      if (purged > 0) console.log('[dsh-livefeed] 清除过期已读卡片 ' + purged + ' 条（保留 ' + state.config.retentionDays + ' 天）');
    }

    async function loadAll() {
      const cfgText = await fsRead(CONFIG_FILE);
      state.config = mergeConfig(defaultConfig(), parseJson(cfgText, null));
      const st = parseJson(await fsRead(STATE_FILE), null);
      state.cards = (st && Array.isArray(st.cards) ? st.cards : [])
        .filter((c) => c && c.url)
        .slice(-CARD_BOUND)
        .map((c) => Object.assign({ isNew: false, createdAt: Date.now() }, c, { isNew: false }));
      purgeExpiredCards(); // 每次采集（含启动装载）前清除过期的已读卡片
      if (st && typeof st.lastRunAt === 'number' && Number.isFinite(st.lastRunAt)) {
        state.lastRunAt = Math.min(st.lastRunAt, Date.now());
      }
      state.archive = [];
      state.seenUrls = new Set();
      const histText = await fsRead(HISTORY_FILE);
      if (histText) {
        for (const line of histText.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          const item = parseJson(t, null);
          if (!item || !item.url) continue;
          state.archive.push(item);
          state.seenUrls.add(normalizeUrl(item.url));
        }
      }
      for (const c of state.cards) state.seenUrls.add(normalizeUrl(c.url));
    }

    // ══ 主周期 ══
    async function runCycle() {
      if (disposed || state.running) return;
      if (state.paused) return;
      state.running = true;
      state.sourceErrors = [];
      state.cycleStats = null;
      state.cycleStamp = Date.now();
      try {
        await loadAll();
        const stats = { scanned: 0, selected: 0, filtered: 0 };
        const source = linuxdoSource(state.config);
        let failed = false;
        if (!source || source.enabled === false) {
          // 源被禁用：保留错误提示；延后 lastRunAt 避免调度器 30s 空转，等待用户修正配置
          state.lastError = 'Linux Do 源已禁用（config.json）';
          state.cycleStats = stats;
        } else {
          try {
            state.progress = { stage: 'coarse', detail: String(source.name || source.id || ''), ts: Date.now() };
            const items = await stageCoarse(source);      // 最新 + 最热门原始列表
            stats.scanned = items.length;
            state.progress = { stage: 'judge', detail: String(source.name || source.id || ''), ts: Date.now() };
            const fresh = await pullFresh(items);         // 按已读 URL 去重 + 固定屏蔽标签 + fetchCount 上限
            const picked = await stageJudge(fresh);       // AI 价值筛选（数量不足时跳过）
            let landed = 0;
            if (picked.length) {
              const entries = [];
              for (const it of picked) {
                state.progress = { stage: 'fine', detail: String(source.name || source.id || ''), ts: Date.now() };
                const e = await fetchItemContent(it, source);
                if (e) entries.push(e);
              }
              if (entries.length) {
                const cards = await stageSummarize(entries);
                state.progress = { stage: 'land', detail: '', ts: Date.now() };
                landed = (await stageLand(cards)).length;   // 实际落卡数（显示与未读一致）
              }
            }
            stats.selected = landed || picked.length;      // 输出数量：以实际落卡为准
            stats.filtered = stats.scanned - stats.selected;
          } catch (err) {
            // 源级失败（CF 质询/浏览器启动失败/模型调用失败等）：保留错误并退避重试
            failed = true;
            state.sourceErrors.push({ sourceId: String(source.id || ''), message: String((err && err.message) || err) });
            state.lastError = String((err && err.message) || err);
            console.error('[dsh-livefeed] source failed:', source.id, err);
          }
          state.cycleStats = stats;
          if (!failed) { state.lastError = undefined; state.retrying = 0; }
          state.tick += 1;
        }
        // 无论成功/失败/禁用都先更新 lastRunAt 再落盘（重启防抖据此判断），
        // 失败路径由 scheduleRetry 退避重试（retrying 只在成功时清零），禁用路径等待用户修正配置
        state.lastRunAt = Date.now();
        await saveState();
        if (failed) scheduleRetry();
      } catch (err) {
        state.lastError = String((err && err.message) || err);
        console.error('[dsh-livefeed] cycle failed:', err);
        state.lastRunAt = Date.now(); // 防御性：外层失败同样延后下次尝试
        await saveState();
        scheduleRetry();
      } finally {
        state.running = false;
        state.progress = null;
      }
    }

    function scheduleRetry() {
      if (disposed || state.paused) return;
      if (state.retrying >= RETRY_MAX) { state.retrying = 0; return; }
      state.retrying += 1;
      const delay = RETRY_BASE_MS * Math.pow(2, state.retrying - 1);
      console.log('[dsh-livefeed] schedule retry', state.retrying, 'delay ms', delay);
      ctx.timeout(() => {
        if (!disposed) runCycle();
      }, delay);
    }

    // ══ 调度器 ══
    function intervalMs() {
      const m = Number(state.config && state.config.intervalMinutes) || DEFAULT_INTERVAL_MIN;
      return Math.max(1, m) * 60 * 1000;
    }
    function tick() {
      if (disposed || state.paused || state.running) return;
      if (state.lastRunAt !== undefined && Date.now() - state.lastRunAt < intervalMs()) return;
      runCycle();
    }

    // ══ RPC 处理器表（HTTP 路由与动态 harness 共用）══
    const handlers = {
      'cards': async () => jsonSafe({
        cards: state.cards.slice(-CARD_BOUND).map((c) => ({
          id: c.id, title: c.title, summary: c.summary, url: c.url,
          sourceName: c.sourceName, publishedAt: c.publishedAt,
          isNew: !!c.isNew, read: !!c.read, createdAt: c.createdAt,
          cycle: c.cycle === undefined || c.cycle === null ? null : c.cycle,
        })),
        status: {
          running: state.running,
          paused: state.paused,
          retrying: state.retrying,
          lastRunAt: state.lastRunAt,
          lastError: state.lastError,
          sourceErrors: state.sourceErrors,
          cycleStats: state.cycleStats,
          progress: state.progress,
          tick: state.tick,
        },
      }),
      'config': async () => jsonSafe({
        config: state.config ? {
          intervalMinutes: state.config.intervalMinutes,
          fetchCount: state.config.fetchCount,
          outputCount: state.config.outputCount,
          retentionDays: state.config.retentionDays,
          summaryLanguage: state.config.summaryLanguage,
          model: state.config.model || null,
        } : null,
      }),
      'refresh': async () => {
        if (state.paused) return { accepted: false, reason: 'paused' };
        if (state.running) return { accepted: false, reason: 'running' };
        runCycle();
        return { accepted: true };
      },
      'mark': async (args) => {
        const a = args || {};
        const card = state.cards.find((c) => c.id === a.cardId);
        if (card && a.read === true) {
          card.read = true;
          card.readAt = Date.now(); // 已读时间（过期清理依据）
          card.isNew = false;
          await saveState();
        }
        return { ok: true };
      },
      'mark-all-read': async () => {
        let changed = false;
        const now = Date.now();
        for (const c of state.cards) {
          if (!c.read) { c.read = true; c.readAt = now; c.isNew = false; changed = true; }
        }
        if (changed) await saveState();
        return { ok: true };
      },
      'set-paused': async (args) => {
        state.paused = !!(args && args.paused);
        return { ok: true, paused: state.paused };
      },
      'update-settings': async (args) => {
        const a = args || {};
        const cfg = state.config || defaultConfig();
        if (typeof a.intervalMinutes === 'number' && a.intervalMinutes >= 1 && a.intervalMinutes <= 1440) cfg.intervalMinutes = Math.round(a.intervalMinutes);
        if (typeof a.fetchCount === 'number' && a.fetchCount >= 1 && a.fetchCount <= 200) cfg.fetchCount = Math.round(a.fetchCount);
        if (typeof a.outputCount === 'number' && a.outputCount >= 1 && a.outputCount <= 50) cfg.outputCount = Math.round(a.outputCount);
        if (typeof a.retentionDays === 'number' && a.retentionDays >= 1 && a.retentionDays <= 90) cfg.retentionDays = Math.round(a.retentionDays);
        state.config = cfg;
        await saveConfig();
        return { ok: true };
      },
    };

    function readBody(req) {
      return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
          chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
    }

    // 请求日志（内存，有界）：诊断浏览器侧是否真的到达本路由
    const requestLog = [];
    function logRequest(req, method, ok, info) {
      requestLog.push({
        ts: new Date().toISOString(),
        httpMethod: req.method,
        url: String(req.url || ''),
        method,
        ok: !!ok,
        info: String(info || ''),
      });
      if (requestLog.length > 200) requestLog.splice(0, requestLog.length - 200);
    }

    // ══ 启动：装载 + HTTP 路由 + 动态 harness + 定时器（随 fiber 自动清理）══
    ctx.effect(() => {
      console.log('[dsh-livefeed] config dir:', CONFIG_DIR);
      loadAll();

      const stopRoute = ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          const send = (status, payload) => {
            res.writeHead(status, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            });
            res.end(JSON.stringify(jsonSafe(payload)));
          };
          let payload = {};
          if (req.method === 'POST') {
            try { payload = JSON.parse(await readBody(req)) || {}; } catch (_) { payload = {}; }
          } else if (req.method === 'GET' || req.method === 'HEAD') {
            try {
              const u = new URL(req.url || '/', 'http://local');
              payload = { method: String(u.searchParams.get('method') || ''), args: {} };
            } catch (_) { payload = {}; }
          }
          const method = String(payload.method || '');
          const handler = handlers[method];
          if (!handler) { logRequest(req, method, false, 'unknown method'); send(404, { ok: false, error: 'unknown method: ' + method }); return; }
          try {
            const data = await handler(payload.args || {});
            logRequest(req, method, true, 'ok');
            send(200, { ok: true, data });
          } catch (err) {
            logRequest(req, method, false, String((err && err.message) || err));
            send(500, { ok: false, error: String((err && err.message) || err) });
          }
        },
      });

      // 动态模式（cordis_define）兼容：harness 为动态 Builtin，真实宿主中不存在
      let stopHarness = null;
      if (typeof harness !== 'undefined') {
        const disposers = Object.keys(handlers).map((m) =>
          harness.handle('dsh-livefeed/' + m, (args) => handlers[m](args)));
        stopHarness = () => disposers.forEach((d) => { try { d(); } catch (_) { /* ignore */ } });
      }

      const stopInterval = ctx.interval(tick, TICK_MS);
      const stopBoot = ctx.timeout(() => {
        if (disposed || state.paused) return;
        if (state.lastRunAt !== undefined && Date.now() - state.lastRunAt < intervalMs()) {
          console.log('[dsh-livefeed] 距上次采集不足间隔，跳过启动采集（上次: ' + new Date(state.lastRunAt).toISOString() + '，间隔: ' + intervalMs() + 'ms）');
          return;
        }
        runCycle();
      }, 15 * 1000);
      return () => {
        disposed = true;
        if (stopRoute) stopRoute();
        if (stopHarness) stopHarness();
        if (stopInterval) stopInterval();
        if (stopBoot) stopBoot();
        closeBrowserSession();
      };
    });
}
export { apply, inject, name };
