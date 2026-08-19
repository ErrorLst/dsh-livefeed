const name = "dsh-livefeed";
const inject = ["timer", "web", "llm", "fs", "agentDefaultModel", "webServer"];
function apply(ctx) {
    // ══ 常量 ══
    // 配置目录解析（跨机器可移植，不硬编码本机路径）：
    // 1) 环境变量 DSH_LIVEFEED_DIR 优先（本机历史数据迁移：setx DSH_LIVEFEED_DIR <旧目录>）；
    // 2) 否则默认 <用户主目录>/.dsh/dsh-livefeed。
    const CONFIG_DIR = (() => {
      const env = (typeof process !== 'undefined' && process.env) ? process.env : null;
      if (env && env.DSH_LIVEFEED_DIR) return String(env.DSH_LIVEFEED_DIR).replace(/[\\/]+$/, '');
      const home = (env && (env.USERPROFILE || env.HOME)) || '.';
      return home + '/.dsh/dsh-livefeed';
    })();
    const CONFIG_FILE = CONFIG_DIR + '/config.json';
    const STATE_FILE = CONFIG_DIR + '/state.json';
    const HISTORY_FILE = CONFIG_DIR + '/history.jsonl';
    const PREFERENCES_FILE = CONFIG_DIR + '/preferences.json';
    const TEMPLATE_FILE = CONFIG_DIR + '/sources/_template.js';
    const ROUTE_PATH = '/api/dsh-livefeed';
    const DEFAULT_INTERVAL_MIN = 60;
    const DEFAULT_MAX_CARDS = 8;
    const DEFAULT_MAX_CANDIDATES = 5;
    const DEFAULT_MAX_ITEMS = 15; // 粗搜默认上限（与模板 DEFAULT_MAX_ITEMS 同值）
    const DEFAULT_ARCHIVE_MAX = 5000;
    const FEEDBACK_WINDOW = 50;
    const FILTER_LOG_CAP = 200;
    const RETRY_MAX = 2;
    const RETRY_BASE_MS = 5 * 60 * 1000;
    const TICK_MS = 30 * 1000; // 调度器基础节拍（实际周期由 config.intervalMinutes 决定）

    // ══ 基类模板 ══
    // 基类模板：优先用运行目录 sources/_template.js（可覆盖定制）；
    // 缺失时回退内置常量 BUILTIN_TEMPLATE —— 由 scripts/build-lib.js 在构建时
    // 自动把 src/template/template.js 以 base64 内联（此处源码恒为空串）。
    const BUILTIN_TEMPLATE = atob('Lyog4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAqIGRzaC1saXZlZmVlZCDmkJzntKLmupDln7rnsbvmqKHmnb/vvIhCYXNlIFRlbXBsYXRl77yJCiAqIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAogKiBIb3N0IOWwhuacrOaooeadv+S4jua6kOiEmuacrOaLvOaOpe+8iHByb2dyYW0gPSDmqKHmnb8gKyAiXG4iICsg5rqQ6ISa5pys77yJ5ZCO77yM5L2c5Li6CiAqIGNvZGVSdW50aW1lIOeahCBwcm9ncmFtIOi/kOihjOOAgua6kOiEmuacrOWPqumcgOWunueOsO+8mgogKgogKiAgIGFzeW5jIGZ1bmN0aW9uIGNvYXJzZVNlYXJjaChhcGkpICAgLy8g5b+F6YCJ77ya57KX5pCc77yM6L+U5ZueIFt7dGl0bGUsIHVybCwgc25pcHBldD8sIHB1Ymxpc2hlZEF0P31dCiAqICAgYXN5bmMgZnVuY3Rpb24gZmluZVNlYXJjaChhcGksIGl0ZW0pIC8vIOWPr+mAie+8mueyvuaQnO+8jOi/lOWbniB7IHRleHQgfe+8iOm7mOiupOWunueOsOingeS4i++8iQogKgogKiDmqKHmnb/lnKjmlofku7blsL7pg6jms6jlhaXosIPluqblmajvvIzkvp3mja4gYXBpLm1vZGUoKSDliIbmtL7vvJvlvZLkuIDljJYv5oiq5patL+WOu+mHjeeUseaooeadv+e7n+S4gOWujOaIkOOAggogKiDmupDohJrmnKzor7fli7/ph43mlrDlo7DmmI7nrKwgNCDoioLkv53nlZnlkI3vvIjop4EgZG9jcy9zb3VyY2UtY29udHJhY3QubWTvvInjgIIKICog5pys5paH5Lu25pivIEhvc3Qg5YaF572u5qih5p2/5bi46YeP55qE5rqQ5aS077ya5L+u5pS55ZCO6ZyA5ZCM5q2l5YiwIEhvc3Qg5Luj56CB5Lit55qE5qih5p2/5bi46YeP44CCCiAqLwondXNlIHN0cmljdCc7CgovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLy8g5bi46YePCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgApjb25zdCBNQVhfQ09OVEVOVF9DSEFSUyA9IDgwMDA7ICAgLy8g57K+5pCc5q2j5paH5LiK6ZmQ77yI5a2X56ym77yJCmNvbnN0IERFRkFVTFRfTUFYX0lURU1TID0gMTU7ICAgICAvLyDnspfmkJzpu5jorqTmnaHnm67kuIrpmZAKCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAovLyDlrZDnsbvlpZHnuqbvvJpjb2Fyc2VTZWFyY2gg5b+F6YCJ77yMZmluZVNlYXJjaCDlj6/pgInvvIjmnInpu5jorqTlrp7njrDvvIkKLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACmFzeW5jIGZ1bmN0aW9uIGNvYXJzZVNlYXJjaChhcGkpIHsKICAvLyDpu5jorqTnspfmkJzvvJrpgJrnlKggd2ViLnNlYXJjaCDlnovvvIjmupDohJrmnKzmnKrlrp7njrDkuJTmnKrphY3nva4gcXVlcnkg5pe25oqb6ZSZ5o+Q56S677yJCiAgY29uc3QgY2ZnID0gYXdhaXQgYXBpLmNvbmZpZyhudWxsKTsKICBjb25zdCBxID0gU3RyaW5nKChjZmcgJiYgY2ZnLnF1ZXJ5KSB8fCAnJykudHJpbSgpOwogIGlmICghcSkgewogICAgdGhyb3cgbmV3IEVycm9yKCdbZHNoLWxpdmVmZWVkXSDmnKrlrp7njrAgY29hcnNlU2VhcmNoIOS4lOa6kOacqumFjee9riBxdWVyeScpOwogIH0KICBjb25zdCByID0gYXdhaXQgc2VhcmNoV2ViKGFwaSwgcSwgKGNmZyAmJiBjZmcubWF4SXRlbXMpIHx8IERFRkFVTFRfTUFYX0lURU1TKTsKICByZXR1cm4gci5tYXAoKHMpID0+ICh7CiAgICB0aXRsZTogcy50aXRsZSB8fCBzLnVybCwKICAgIHVybDogcy51cmwsCiAgICBzbmlwcGV0OiBzLnNuaXBwZXQgfHwgJycsCiAgICBwdWJsaXNoZWRBdDogcy5wdWJsaXNoZWRBdCB8fCB1bmRlZmluZWQsCiAgfSkpOwp9Cgphc3luYyBmdW5jdGlvbiBmaW5lU2VhcmNoKGFwaSwgaXRlbSkgewogIC8vIOm7mOiupOeyvuaQnO+8muaKk+WPluadoeebriBVUkwg5bm25o+Q5Y+W5q2j5paH77yI57qv6ZO+5o6l5YiX6KGo5Z6L5rqQ5peg6ZyA6KaG55uW77yJCiAgY29uc3QgcGFnZSA9IGF3YWl0IGZldGNoUGFnZShhcGksIGl0ZW0udXJsKTsKICByZXR1cm4geyB0ZXh0OiBodG1sVG9UZXh0KHBhZ2UuYm9keS5jb250ZW50LCBNQVhfQ09OVEVOVF9DSEFSUykgfTsKfQoKLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACi8vIOWFrOWFseW3peWFt++8iOWfuuexu+aWueazle+8jOa6kOiEmuacrOWPr+ebtOaOpeiwg+eUqO+8iQovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLyoqIOWMheijhSBhcGkuc2VhcmNo77yM6L+U5ZueIHNvdXJjZXNbXSAqLwphc3luYyBmdW5jdGlvbiBzZWFyY2hXZWIoYXBpLCBxdWVyeSwgbWF4UmVzdWx0cykgewogIGNvbnN0IHIgPSBhd2FpdCBhcGkuc2VhcmNoKHsKICAgIHF1ZXJ5OiBTdHJpbmcocXVlcnkpLAogICAgbWF4UmVzdWx0czogbWF4UmVzdWx0cyB8fCBERUZBVUxUX01BWF9JVEVNUywKICB9KTsKICByZXR1cm4gKHIgJiYgQXJyYXkuaXNBcnJheShyLnNvdXJjZXMpID8gci5zb3VyY2VzIDogW10pOwp9CgovKiog5YyF6KOFIGFwaS5mZXRjaENvbnRlbnQgKi8KYXN5bmMgZnVuY3Rpb24gZmV0Y2hQYWdlKGFwaSwgdXJsKSB7CiAgcmV0dXJuIGFwaS5mZXRjaENvbnRlbnQoeyB1cmw6IFN0cmluZyh1cmwpIH0pOwp9CgovKiogSFRNTCDlrp7kvZPop6PnoIHvvIjlkKsgPGJyPiDmjaLooYzjgIHljrvmoIfnrb7jgIHmlbDlrZcv5Y2B5YWt6L+b5Yi25a6e5L2T5aaCICYjeDJGO++8iSAqLwpmdW5jdGlvbiBkZWNvZGVFbnRpdGllcyhzKSB7CiAgcmV0dXJuIFN0cmluZyhzKQogICAgLnJlcGxhY2UoLzxiclxzKlwvPz4vZ2ksICdcbicpCiAgICAucmVwbGFjZSgvPFtePl0rPi9nLCAnICcpCiAgICAucmVwbGFjZSgvJm5ic3A7L2dpLCAnICcpCiAgICAucmVwbGFjZSgvJmx0Oy9naSwgJzwnKQogICAgLnJlcGxhY2UoLyZndDsvZ2ksICc+JykKICAgIC5yZXBsYWNlKC8mcXVvdDsvZ2ksICciJykKICAgIC5yZXBsYWNlKC8mI3goWzAtOWEtZkEtRl0rKTsvZywgKG0sIGgpID0+IFN0cmluZy5mcm9tQ2hhckNvZGUocGFyc2VJbnQoaCwgMTYpKSkKICAgIC5yZXBsYWNlKC8mIyhcZCspOy9nLCAobSwgZCkgPT4gU3RyaW5nLmZyb21DaGFyQ29kZShOdW1iZXIoZCkpKQogICAgLnJlcGxhY2UoLyZhbXA7L2dpLCAnJicpOwp9CgovKiog6YCa55SoIEhUTUzihpLmlofmnKzvvJrljrvmoIfnrb7jgIHljovnvKnnqbrnmb3vvIzlj6/pgInmiKrmlq0gKi8KZnVuY3Rpb24gaHRtbFRvVGV4dChodG1sLCBtYXhMZW4pIHsKICBsZXQgdGV4dCA9IGRlY29kZUVudGl0aWVzKGh0bWwpCiAgICAucmVwbGFjZSgvWyBcdF0rL2csICcgJykKICAgIC5yZXBsYWNlKC9cbnszLH0vZywgJ1xuXG4nKQogICAgLnRyaW0oKTsKICBpZiAobWF4TGVuICYmIHRleHQubGVuZ3RoID4gbWF4TGVuKSB0ZXh0ID0gdGV4dC5zbGljZSgwLCBtYXhMZW4pICsgJ+KApic7CiAgcmV0dXJuIHRleHQ7Cn0KCi8qKiDlj5blgLzovoXliqnvvIjlrZfnrKbkuLLplK7miJblh73mlbDvvIkgKi8KZnVuY3Rpb24gcGljayhvYmosIGtleSkgewogIGlmIChrZXkgPT09IG51bGwgfHwga2V5ID09PSB1bmRlZmluZWQpIHJldHVybiAnJzsKICBpZiAodHlwZW9mIGtleSA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGtleShvYmopOwogIGNvbnN0IHYgPSBvYmpba2V5XTsKICByZXR1cm4gdiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQgPyAnJyA6IFN0cmluZyh2KTsKfQoKLyoqIOWwhiBKU09OIEFQSSDliJfooajop4TmlbTkuLogaXRlbXPvvJp7dGl0bGVLZXksIHVybEtleSwgc25pcHBldEtleT8sIHB1Ymxpc2hlZEF0S2V5PywgdXJsRmFsbGJhY2s/fSAqLwpmdW5jdGlvbiBqc29uSXRlbXMobGlzdCwgb3B0cykgewogIGNvbnN0IG8gPSBvcHRzIHx8IHt9OwogIHJldHVybiAoQXJyYXkuaXNBcnJheShsaXN0KSA/IGxpc3QgOiBbXSkubWFwKCh4KSA9PiAoewogICAgdGl0bGU6IHBpY2soeCwgby50aXRsZUtleSksCiAgICB1cmw6IHBpY2soeCwgby51cmxLZXkpIHx8ICh0eXBlb2Ygby51cmxGYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJyA/IHBpY2soeCwgby51cmxGYWxsYmFjaykgOiAnJyksCiAgICBzbmlwcGV0OiBvLnNuaXBwZXRLZXkgPyBwaWNrKHgsIG8uc25pcHBldEtleSkgOiAnJywKICAgIHB1Ymxpc2hlZEF0OiBvLnB1Ymxpc2hlZEF0S2V5ID8gcGljayh4LCBvLnB1Ymxpc2hlZEF0S2V5KSB8fCB1bmRlZmluZWQgOiB1bmRlZmluZWQsCiAgfSkpOwp9CgovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLy8g5b2S5LiA5YyW77yI5qih5p2/5YaF6YOo77yJCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgApmdW5jdGlvbiBfbm9ybWFsaXplVGl0bGVzKGl0ZW1zLCBjZmcpIHsKICBpZiAoIUFycmF5LmlzQXJyYXkoaXRlbXMpKSB7CiAgICB0aHJvdyBuZXcgRXJyb3IoJ1tkc2gtbGl2ZWZlZWRdIGNvYXJzZVNlYXJjaCDlv4Xpobvov5Tlm57mlbDnu4QnKTsKICB9CiAgY29uc3QgbWF4ID0gKGNmZyAmJiBjZmcubWF4SXRlbXMpIHx8IERFRkFVTFRfTUFYX0lURU1TOwogIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7CiAgY29uc3Qgb3V0ID0gW107CiAgZm9yIChjb25zdCBpdCBvZiBpdGVtcykgewogICAgaWYgKCFpdCB8fCB0eXBlb2YgaXQgIT09ICdvYmplY3QnKSBjb250aW51ZTsKICAgIGNvbnN0IHVybCA9IFN0cmluZyhpdC51cmwgfHwgJycpLnRyaW0oKTsKICAgIGNvbnN0IHRpdGxlID0gU3RyaW5nKGl0LnRpdGxlIHx8ICcnKS50cmltKCk7CiAgICBpZiAoIXVybCB8fCAhdGl0bGUgfHwgc2Vlbi5oYXModXJsKSkgY29udGludWU7CiAgICBzZWVuLmFkZCh1cmwpOwogICAgb3V0LnB1c2goewogICAgICB0aXRsZSwKICAgICAgdXJsLAogICAgICBzbmlwcGV0OiBpdC5zbmlwcGV0ID8gU3RyaW5nKGl0LnNuaXBwZXQpLnNsaWNlKDAsIDUwMCkgOiAnJywKICAgICAgcHVibGlzaGVkQXQ6IHR5cGVvZiBpdC5wdWJsaXNoZWRBdCA9PT0gJ3N0cmluZycgPyBpdC5wdWJsaXNoZWRBdCA6IHVuZGVmaW5lZCwKICAgIH0pOwogICAgaWYgKG91dC5sZW5ndGggPj0gbWF4KSBicmVhazsKICB9CiAgcmV0dXJuIG91dDsKfQoKZnVuY3Rpb24gX25vcm1hbGl6ZUNvbnRlbnQob3V0KSB7CiAgaWYgKCFvdXQgfHwgdHlwZW9mIG91dCAhPT0gJ29iamVjdCcpIHsKICAgIHRocm93IG5ldyBFcnJvcignW2RzaC1saXZlZmVlZF0gZmluZVNlYXJjaCDlv4Xpobvov5Tlm54geyB0ZXh0IH0nKTsKICB9CiAgY29uc3QgdGV4dCA9IFN0cmluZyhvdXQudGV4dCB8fCAnJykudHJpbSgpOwogIGlmICghdGV4dCkgdGhyb3cgbmV3IEVycm9yKCdbZHNoLWxpdmVmZWVkXSBmaW5lU2VhcmNoIOi/lOWbnueahOato+aWh+S4uuepuicpOwogIHJldHVybiB7IHRleHQ6IHRleHQuc2xpY2UoMCwgTUFYX0NPTlRFTlRfQ0hBUlMpIH07Cn0KCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAovLyDosIPluqblmajvvIjmqKHmnb/lhoXnva7vvJvmupDohJrmnKzml6DpnIDlhbPlv4PvvIkKLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACmFzeW5jIGZ1bmN0aW9uIF9kc2hMaXZlZmVlZERpc3BhdGNoZXIoKSB7CiAgY29uc3QgbW9kZSA9IGF3YWl0IGFwaS5tb2RlKG51bGwpOwogIGlmIChtb2RlID09PSAndGl0bGVzJykgewogICAgcmV0dXJuIF9ub3JtYWxpemVUaXRsZXMoYXdhaXQgY29hcnNlU2VhcmNoKGFwaSksIGF3YWl0IGFwaS5jb25maWcobnVsbCkpOwogIH0KICBpZiAobW9kZSA9PT0gJ2NvbnRlbnQnKSB7CiAgICBjb25zdCBpdGVtID0gYXdhaXQgYXBpLml0ZW0obnVsbCk7CiAgICByZXR1cm4gX25vcm1hbGl6ZUNvbnRlbnQoYXdhaXQgZmluZVNlYXJjaChhcGksIGl0ZW0pKTsKICB9CiAgdGhyb3cgbmV3IEVycm9yKCdbZHNoLWxpdmVmZWVkXSDmnKrnn6XmqKHlvI86ICcgKyBTdHJpbmcobW9kZSkpOwp9CgpyZXR1cm4gYXdhaXQgX2RzaExpdmVmZWVkRGlzcGF0Y2hlcigpOwo=');

    // ══ 运行时状态（进程内存）══
    const state = {
      config: null,          // 当前配置（加载失败时用内置默认）
      cards: [],             // 面板卡片（未读 + 不感兴趣 + 有界已读）
      seenUrls: new Set(),   // 持久去重集合（启动装载，周期追加）
      archive: [],           // history.jsonl 内存镜像（有界）
      preferences: null,     // 规则文档（AI 维护 + 用户可编辑）
      exemptUrls: new Set(), // 豁免集（撤销屏蔽）
      feedbackQueue: [],     // 未消费的「不感兴趣」标记（有界，规则学习消费）
      filterLog: [],         // 被屏蔽内容（内存，有界；标题为 AI 译文）
      pendingRejected: [],   // 本周期待翻译的被拒条目（周期结束批量翻译后写入 filterLog）
      titleCache: new Map(), // 标题译文缓存（url(normalized) → 译文，防重复翻译）
      cycleStats: null,      // {scanned, selected, filtered}
      progress: null,        // {stage, detail, ts} 当前管线阶段（面板进度显示）
      running: false,
      paused: false,
      retrying: 0,
      lastRunAt: undefined,
      lastError: undefined,
      sourceErrors: [],
      tick: 0,
      mid: 0,                // 消息 id 计数器
      cycleStamp: null,      // 当前刷新周期时间戳（卡片/屏蔽条目按它分组折叠，重启后依旧唯一可排序）
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
        maxCards: DEFAULT_MAX_CARDS,
        maxCandidatesPerSource: DEFAULT_MAX_CANDIDATES,
        maxCoarseItems: DEFAULT_MAX_ITEMS,
        summaryLanguage: 'zh-CN',
        interests: [],
        blockWords: [],
        archiveMaxEntries: DEFAULT_ARCHIVE_MAX,
        model: null,
        sources: [],
      };
    }
    function defaultPreferences() {
      return { version: 1, updatedAt: undefined, prefer: [], block: [], sourceWeights: {}, semanticNotes: '' };
    }
    function mergeConfig(base, cfg) {
      if (!cfg || typeof cfg !== 'object') return base;
      const out = {};
      for (const k of Object.keys(base)) out[k] = cfg[k] !== undefined ? cfg[k] : base[k];
      if (!Array.isArray(out.sources)) out.sources = [];
      if (!Array.isArray(out.interests)) out.interests = [];
      if (!Array.isArray(out.blockWords)) out.blockWords = [];
      return out;
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
      // 源级 fetch:"browser"：直接走系统 Edge 有头离屏抓取（CF 托管质询站点专用，
      // 纯 HTTP 客户端一律 403、无头浏览器被识别；跳过 web.fetch/node/curl 的超时浪费）
      if (opts && opts.viaBrowser) {
        try {
          return await fetchViaBrowser(String(url));
        } catch (err) {
          throw new Error('浏览器抓取失败 ' + String(url) + '（' + errMsg(err) + '）');
        }
      }
      const reasons = [];
      // 本机配置了代理环境变量时，直连（web.fetch / node fetch）对外部站点几乎必超时，
      // 白等 20-40s/条后才轮到 curl（自动继承代理）成功 —— 直接跳过直连层走 curl。
      // 无代理环境变量的部署保持原链路：web.fetch → node fetch → curl。
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
    // Node 内置 fetch（bundle 模式运行在真实 Node 进程）：免 bash/curl/沙箱依赖，
    // 本机直连即可；动态模式无 fetch 全局时自动跳过。
    // 自动重试一次；失败信息带 cause.code（ECONNREFUSED/ECONNRESET/ETIMEDOUT 等），便于定位网络/代理问题。
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
      // 本机 shell 服务是 PowerShell（dsh-pwsh-sandbox）：`curl` 会被解析成 Invoke-WebRequest 别名，
      // 因此必须显式用 `curl.exe` 调用真实 curl。
      // 本机沙箱后端（windows-acl）要求临时目录在 workspace 之外；当 workspace 位于用户主目录时不可用，
      // 部署默认的 workspace-write 策略会直接失败。此处仅对本抓取调用显式使用 danger-full-access
      // （pwsh-sandbox 对 danger-full-access 直接放行、不套沙箱），不改动部署默认策略。
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
    // 背景：linux.do 等站点位于 Cloudflare 托管质询之后 —— web.fetch/node fetch/curl 一律 403
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
      // 重置空闲计时：空闲 BROWSER_IDLE_MS 后自动关闭（下一次请求会重新拉起）
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
              headless: false, // 有头是硬要求：无头被 CF 识别；窗口置于屏幕外
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
    // 重置浏览器档案：关会话 → 等进程释放文件句柄 → 删除 profile 目录（下次请求自动重建全新档案）。
    // 用途：CF 质询「cookie 监狱」自愈 —— 代理出口 IP 变更后，旧 profile 里失效的
    // cf_clearance/__cf_bm 会让质询页永不通过（实测：全新档案同 IP 秒过，旧档案 403 卡死）。
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
        // 可能是残留 Edge 进程占用 profile：清掉会话重试一次
        await closeBrowserSession();
        page = await getBrowserPage();
      }
      touchBrowserSession();
      const chalText = (s) => s.indexOf('请稍候') >= 0 || s.indexOf('Just a moment') >= 0 || s.indexOf('cf-chl') >= 0;
      // 新版 CF 托管质询页 body 为空、只有标题「请稍候…」：判定必须同时看标题，
      // 否则空正文会被误报成「浏览器抓取内容为空」。
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
            continue; // 第二轮使用全新档案
          }
          let t = String(st.text || '').trim();
          if (t && t[0] !== '{' && t[0] !== '[') {
            // JSON 端点偶发被 <pre> 包裹渲染：从 DOM 里兜底提取
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
        },
      }];
      const run = await codeRuntime.run({ program, bindings });
      if (run.error) throw new Error('脚本执行失败: ' + run.error.message);
      return run.value;
    }

    // ══ 屏蔽日志 ══
    // 被拒条目先入 pendingRejected，周期结束时批量翻译标题后再写入 filterLog（译文直接存进日志）
    function queueRejected(it, source, reason) {
      state.pendingRejected.push({
        title: String(it.title || ''),
        url: String(it.url || ''),
        sourceId: source ? String(source.id || '') : '',
        reason,
        ts: new Date().toISOString(),
        cycle: state.cycleStamp || null,
      });
    }

    // ══ 管线阶段 ══
    async function stageCoarse(source) {
      const program = await loadTemplateAndScript(source);
      // 粗搜上限：优先源级 maxItems，否则全局 maxCoarseItems，模板兜底 DEFAULT_MAX_ITEMS
      const effective = Object.assign({}, source || {}, {
        maxItems: (source && source.maxItems) || state.config.maxCoarseItems || DEFAULT_MAX_ITEMS,
      });
      const items = await runSourceScript(program, { mode: 'titles', config: effective });
      return Array.isArray(items) ? items : [];
    }

    async function stageJudge(source, items) {
      const effectiveBlock = (state.config.blockWords || []).concat(state.preferences.block || []);
      // 确定性过滤
      const kept = [];
      for (const it of items) {
        const urlKey = normalizeUrl(it.url);
        if (state.exemptUrls.has(urlKey)) { kept.push(it); continue; }
        // 已见过的条目（含启动时从 history.jsonl 装载的历史卡片）直接跳过：
        // 不占精读上限、不进 LLM 判定、不记入屏蔽日志。arXiv/Solidot 等 RSS 按
        // 旧→新排列且条目存续数天，每周期都会重复出现，若不提前跳过，
        // maxCandidates 名额永远被旧文占满（新文反而被记为「候选上限截断」）。
        if (state.seenUrls.has(urlKey)) continue;
        const title = String(it.title || '').toLowerCase();
        const hit = (effectiveBlock || []).find((w) => w && title.indexOf(String(w).toLowerCase()) >= 0);
        if (hit) { queueRejected(it, source, 'block-keyword'); continue; }
        kept.push(it);
      }
      if (!kept.length) return [];
      // 语义过滤：reasoning effort 较高时输出预算可能被思考过程占用导致 JSON 截断，
      // 解析失败自动重试（最多 3 次），并加大输出预算。
      const list = kept.map((it, i) => ({ i, title: it.title, url: it.url, snippet: String(it.snippet || '').slice(0, 200) }));
      const recent = state.feedbackQueue.slice(-10).map((f) => '【不感兴趣】' + f.title);
      const system =
        '你是信息筛选助手。用户配置了兴趣词，判断哪些条目值得精读并生成摘要卡片。' +
        '\n兴趣: ' + JSON.stringify(state.config.interests || []) +
        '\n规则: ' + JSON.stringify({ prefer: state.preferences.prefer || [], block: effectiveBlock, semanticNotes: state.preferences.semanticNotes || '' }) +
        '\n最近不感兴趣样本: ' + JSON.stringify(recent) +
        '\n判定标准：与任一兴趣词相关的条目都应入选。相关不仅指标题字面命中，还包括衍生主题' +
        '（例如兴趣「AI」涵盖模型/工具/应用/公司动态/LLM 与 Agent/开发者生态；「计算机」涵盖编程、软件、硬件、网络、科技新闻；其他兴趣同理）。' +
        '只有明显与所有兴趣都不相关的条目才拒绝；拿不准时倾向入选（宁可多选）。' +
        '兴趣词按日常通俗含义理解（如「情感」指生活情感/人际关系/家庭/婚恋/情绪话题，不是情感计算等技术含义）。' +
        '用户可在面板对多余条目标记「不感兴趣」，系统会据此学习收紧，无需你过度保守。' +
        '\n只输出 JSON: {"selected":[{"index":0,"reason":"一句话理由"}]}。';
      let parsed = null;
      // 思考等级较高时输出预算可能被思考过程占用导致 JSON 截断；重试逐次加大预算
      const budgets = [4000, 6000, 8000];
      for (let attempt = 1; attempt <= 3; attempt++) {
        const raw = await callModel(system, JSON.stringify(list, null, 1), budgets[attempt - 1]);
        parsed = extractJson(raw);
        if (parsed && Array.isArray(parsed.selected)) break;
        console.warn('[dsh-livefeed] judge parse failed, retry', attempt + '/3');
      }
      const selected = new Set();
      if (parsed && Array.isArray(parsed.selected)) {
        for (const s of parsed.selected) {
          const idx = Number(s && s.index);
          if (Number.isInteger(idx) && idx >= 0 && idx < kept.length) selected.add(idx);
        }
      } else {
        throw new Error('筛选结果解析失败');
      }
      const out = [];
      for (let i = 0; i < kept.length; i++) {
        if (selected.has(i)) out.push(kept[i]);
        else queueRejected(kept[i], source, 'model-filter');
      }
      // 精搜上限：优先源级 maxCandidates，否则全局 maxCandidatesPerSource。
      // 被截断的选中项记入屏蔽日志（reason=max-candidates），保证统计数字与屏蔽列表可核对。
      const cap = (source && source.maxCandidates) || state.config.maxCandidatesPerSource || DEFAULT_MAX_CANDIDATES;
      for (let i = cap; i < out.length; i++) queueRejected(out[i], source, 'max-candidates');
      return out.slice(0, cap);
    }

    // ══ 屏蔽日志标题翻译（周期末尾批量执行，译文直接写入 filterLog）══
    async function stageTranslateRejected() {
      const pending = state.pendingRejected;
      state.pendingRejected = [];
      if (!pending.length) return;
      // 按 URL 去重（保留最新）；同一内容每周期重复被拒时只留一条
      const seen = new Set();
      const unique = [];
      for (const e of pending) {
        const key = normalizeUrl(e.url);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(e);
      }
      const byUrl = new Map();
      const need = [];
      for (const e of unique) {
        const key = normalizeUrl(e.url);
        const cached = state.titleCache.get(key);
        if (cached !== undefined) byUrl.set(key, cached);
        else need.push({ url: e.url, title: e.title });
      }
      if (need.length) {
        try {
          const lang = state.config.summaryLanguage || 'zh-CN';
          const system =
            '将以下标题翻译成「' + lang + '」。专有名词/产品名/品牌名可保留原文；已是目标语言的标题原样返回。' +
            '只输出 JSON 数组，顺序对应输入：[{"url":"…","title":"翻译后的标题"}]';
          const raw = await callModel(system, JSON.stringify(need.map((m) => ({ url: m.url, title: m.title }))), 2500);
          const parsed = extractJsonArr(raw);
          if (Array.isArray(parsed)) {
            for (const p of parsed) {
              if (!p || !p.url) continue;
              const t = String(p.title || '').trim();
              if (t) state.titleCache.set(normalizeUrl(String(p.url)), t);
            }
          }
        } catch (err) {
          console.error('[dsh-livefeed] title translate failed:', String((err && err.message) || err));
        }
        for (const e of need) {
          const key = normalizeUrl(e.url);
          if (!state.titleCache.has(key)) state.titleCache.set(key, e.title);
          byUrl.set(key, state.titleCache.get(key));
        }
      }
      // 缓存有界（简单淘汰）
      if (state.titleCache.size > 500) {
        const firstKey = state.titleCache.keys().next().value;
        if (firstKey !== undefined) state.titleCache.delete(firstKey);
      }
      // 写入屏蔽日志：同 URL 旧条目替换为最新（标题=译文）
      for (const e of unique) {
        const key = normalizeUrl(e.url);
        state.filterLog = state.filterLog.filter((x) => normalizeUrl(x.url) !== key);
        state.filterLog.push({
          title: byUrl.get(key) || e.title,
          url: e.url,
          sourceId: e.sourceId,
          reason: e.reason,
          ts: e.ts,
          cycle: e.cycle || null,
        });
      }
      if (state.filterLog.length > FILTER_LOG_CAP) state.filterLog.splice(0, state.filterLog.length - FILTER_LOG_CAP);
    }

    async function stageCluster(candidates) {
      if (candidates.length <= 1) return candidates.map((c) => ({ members: [c] }));
      const list = candidates.map((c, i) => ({ i, title: c.item.title, url: c.item.url, source: c.source.name }));
      const system =
        '将以下条目按“同一事件/话题”聚类（不同网站报道同一新闻算同一簇）。' +
        '只输出 JSON: {"clusters":[{"members":[0,2]}]}。每个条目只能属于一个簇；无法归并的条目单独成簇 [i]。';
      // 解析失败重试（最多 3 次，预算逐次加大）；仍失败则退回「各自成簇」（不会中断周期）
      let parsed = null;
      const budgets = [2500, 4000, 6000];
      for (let attempt = 1; attempt <= 3; attempt++) {
        const raw = await callModel(system, JSON.stringify(list, null, 1), budgets[attempt - 1]);
        parsed = extractJson(raw);
        if (parsed && Array.isArray(parsed.clusters)) break;
        console.warn('[dsh-livefeed] cluster parse failed, retry', attempt + '/3');
      }
      const clusters = [];
      const used = new Set();
      if (parsed && Array.isArray(parsed.clusters)) {
        for (const cl of parsed.clusters) {
          const members = (Array.isArray(cl && cl.members) ? cl.members : [])
            .map((m) => Number(m))
            .filter((m) => Number.isInteger(m) && m >= 0 && m < candidates.length && !used.has(m));
          if (!members.length) continue;
          for (const m of members) used.add(m);
          clusters.push({ members: members.map((m) => candidates[m]) });
        }
      }
      for (let i = 0; i < candidates.length; i++) {
        if (!used.has(i)) clusters.push({ members: [candidates[i]] });
      }
      return clusters;
    }

    function pickMain(members) {
      const weights = state.preferences.sourceWeights || {};
      let best = members[0];
      for (const m of members) {
        const w1 = weights[m.source.id] || 1;
        const w2 = weights[best.source.id] || 1;
        if (w1 > w2) { best = m; continue; }
        if (w1 === w2) {
          const t1 = m.item.publishedAt ? Date.parse(m.item.publishedAt) : NaN;
          const t2 = best.item.publishedAt ? Date.parse(best.item.publishedAt) : NaN;
          if ((isNaN(t2) && !isNaN(t1)) || (!isNaN(t1) && !isNaN(t2) && t1 < t2)) best = m;
        }
      }
      return best;
    }

    // 安全验证页/反爬拦截页识别：这类页面文本非空但内容无效，
    // 命中后视为「正文为空」→ 卡片直接丢弃（不生成拦截提示类摘要）
    function isBlockPage(text) {
      const t = String(text || '').toLowerCase();
      // 强特征：出现即判定（几乎不会出现在正常正文）
      const strong = [
        'attention required', 'checking your browser', 'verify you are human',
        'enable javascript and cookies', 'just a moment', 'access denied',
        'you have been blocked', 'cf-chl', 'captcha', 'puzzle',
        'your current connection has been blocked', 'we have detected unusual activity',
        '异常活动', '安全系统阻止', '检测到异常', '安全验证',
      ];
      for (const m of strong) if (t.indexOf(m) >= 0) return true;
      // 弱特征：短页面（拦截页通常很小）且命中多个才判定，避免误杀正常长文
      const weak = ['cloudflare', 'akamai', 'security check', 'bot', 'challenge', 'reference number', 'permission', 'blocked', '被阻止', '安全系统'];
      let w = 0;
      if (t.length < 12000) {
        for (const m of weak) if (t.indexOf(m) >= 0) w++;
      }
      return w >= 2;
    }

    const SUMMARIZE_INPUT_BUDGET = 30000; // 每个搜索源单次摘要调用的总输入预算（字符，≈15k tokens 内）

    // 单簇精搜：抓正文（网络请求，非模型调用）；无正文且无片段时返回 null（该簇丢弃）
    async function fetchClusterContent(cluster) {
      const main = pickMain(cluster.members);
      let content = null;
      try {
        const program = await loadTemplateAndScript(main.source);
        const out = await runSourceScript(program, { mode: 'content', config: main.source, item: main.item });
        if (out && out.text) {
          if (isBlockPage(out.text)) {
            console.log('[dsh-livefeed] block-page content skipped:', main.item.url);
            content = null;
          } else {
            content = out.text;
          }
        }
      } catch (err) {
        console.error('[dsh-livefeed] fineSearch failed:', String(err && err.message || err));
      }
      const snippets = cluster.members.map((m) => (m.item.snippet || '')).filter(Boolean).join('\n');
      const fallbackText = content || snippets;
      if (!fallbackText) return null;
      return { cluster, main, content, fallbackText, sourceText: (content || snippets).slice(0, 6000) };
    }

    // 按源批量精读+摘要：抓取仍逐簇进行；每个搜索源的所有精读条目合并为一次模型调用，
    // 条目多时自动压缩每条正文长度以适配单次输入预算；单源失败只影响该源。
    async function stageFineAndSummarizeAll(clusters) {
      const lang = state.config.summaryLanguage || 'zh-CN';
      const cards = [];
      const entries = [];
      for (const cl of clusters) {
        const c = await fetchClusterContent(cl);
        if (c) entries.push(c);
      }
      // 按搜索源分组（不同源不混批）
      const bySource = new Map();
      for (const e of entries) {
        const sid = e.main.source.id || '?';
        if (!bySource.has(sid)) bySource.set(sid, []);
        bySource.get(sid).push(e);
      }
      let gi = 0;
      for (const [sid, group] of bySource) {
        gi += 1;
        const sourceName = (group[0].main.source.name || sid);
        state.progress = { stage: 'fine', detail: sourceName + '（' + (gi + 1) + '/' + bySource.size + '）', ts: Date.now() };
        // 每条正文按预算均分（上限 6000/条），保证整组一次调用放得下
        const perItem = Math.max(800, Math.min(6000, Math.floor(SUMMARIZE_INPUT_BUDGET / group.length)));
        const results = new Array(group.length).fill(null);
        try {
          const system =
            '你是资讯摘要助手。以下内容来自搜索源「' + sourceName + '」。对每条内容生成「' + lang + '」标题与 2-3 句摘要。' +
            '标题必须翻译成「' + lang + '」（专有名词/产品名/品牌名可保留原文）。只输出 JSON 数组，顺序对应输入，' +
            '每条都必须包含 index/title/summary：[{"index":0,"title":"…","summary":"…"}]';
          const input = JSON.stringify(group.map((e, i) => ({ index: i, title: e.main.item.title, content: e.sourceText.slice(0, perItem) })));
          const raw = await callModel(system, input, Math.min(12000, 2000 + group.length * 400));
          const parsed = extractJsonArr(raw);
          if (Array.isArray(parsed)) {
            for (const p of parsed) {
              if (!p || typeof p.index !== 'number' || !Number.isInteger(p.index) || p.index < 0 || p.index >= group.length) continue;
              if (p.title && p.summary) results[p.index] = { title: String(p.title), summary: String(p.summary) };
            }
          }
        } catch (err) {
          console.error('[dsh-livefeed] summarize failed for source ' + sid + ':', String((err && err.message) || err));
        }
        for (let i = 0; i < group.length; i++) {
          const e = group[i];
          const r = results[i];
          cards.push({
            title: r ? r.title : e.main.item.title,
            summary: r ? r.summary : e.fallbackText.slice(0, 300),
            url: e.main.item.url,
            sourceName: e.main.source.name,
            publishedAt: e.main.item.publishedAt,
            relatedUrls: e.cluster.members
              .filter((m) => m.item.url !== e.main.item.url)
              .map((m) => ({ url: m.item.url, sourceName: m.source.name })),
          });
        }
      }
      return cards;
    }

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
          relatedUrls: card.relatedUrls || [],
          read: false,
          feedback: null,
          isNew: true,
          createdAt: Date.now(),
          cycle: state.cycleStamp || null,
        };
        newCards.push(full);
        state.cards.push(full);
      }
      // 有界：裁剪最老的「已读且非不感兴趣」卡片（仅入归档）
      const bound = (state.config.maxCards || DEFAULT_MAX_CARDS) * 3;
      if (state.cards.length > bound) {
        const removable = state.cards.filter((c) => c.read && c.feedback !== 'dislike');
        let over = state.cards.length - bound;
        for (const r of removable) {
          if (over <= 0) break;
          const idx = state.cards.indexOf(r);
          if (idx >= 0) { state.cards.splice(idx, 1); over--; }
        }
      }
      // 归档（有界滚动）
      for (const c of newCards) {
        state.archive.push({ id: c.id, title: c.title, url: c.url, summary: c.summary, sourceName: c.sourceName, publishedAt: c.publishedAt, createdAt: c.createdAt });
      }
      await saveArchive();
      return newCards;
    }

    async function stageRules() {
      if (!state.feedbackQueue.length) return;
      const recent = state.feedbackQueue;
      state.feedbackQueue = [];
      try {
        const system =
          '你是过滤规则维护助手。根据用户最近标记的「不感兴趣」内容更新规则文档。' +
          '规则只允许增加负面规则（block / semanticNotes），禁止推断用户的正向偏好（防止信息茧房）。' +
          '只输出 JSON: {"block":["关键词","…"],"semanticNotes":"一句话"}。block 是合并去重后的完整列表（含原有条目），semanticNotes 是更新后的完整文本。';
        const user =
          '当前规则: ' + JSON.stringify({ block: state.preferences.block, semanticNotes: state.preferences.semanticNotes }) +
          '\n新增不感兴趣: ' + JSON.stringify(recent.map((r) => r.title));
        const parsed = extractJson(await callModel(system, user, 1500));
        if (parsed && Array.isArray(parsed.block)) {
          state.preferences.block = parsed.block.filter((b) => b && String(b).trim()).map((b) => String(b).trim());
          state.preferences.semanticNotes = String(parsed.semanticNotes || state.preferences.semanticNotes || '');
          state.preferences.version = (state.preferences.version || 1) + 1;
          state.preferences.updatedAt = new Date().toISOString();
          await savePreferences();
        }
      } catch (err) {
        console.error('[dsh-livefeed] rules update failed:', String(err && err.message || err));
      }
    }

    // ══ 规则重训（抽样归档）══
    async function runRerunRules() {
      if (state.running) return;
      state.running = true;
      try {
        const sample = state.archive.filter((x) => x.feedback === 'dislike').slice(-30).map((d) => d.title);
        const system =
          '你是过滤规则维护助手。基于用户历史「不感兴趣」样本重写规则。只允许负面规则（block / semanticNotes），禁止推断正向偏好。' +
          '只输出 JSON: {"block":["关键词","…"],"semanticNotes":"一句话"}。';
        const parsed = extractJson(await callModel(system, '不感兴趣样本: ' + JSON.stringify(sample), 1500));
        if (parsed && Array.isArray(parsed.block)) {
          state.preferences.block = parsed.block.map((b) => String(b).trim()).filter(Boolean);
          state.preferences.semanticNotes = String(parsed.semanticNotes || '');
          state.preferences.version = (state.preferences.version || 1) + 1;
          state.preferences.updatedAt = new Date().toISOString();
          await savePreferences();
        }
      } catch (err) {
        console.error('[dsh-livefeed] rerun rules failed:', String(err && err.message || err));
      } finally {
        state.running = false;
      }
    }

    // ══ 持久化 ══
    async function saveState() {
      const panelCards = state.cards.filter((c) => !c.read || c.feedback === 'dislike');
      await fsWrite(STATE_FILE, JSON.stringify({
        cards: panelCards,
        exemptUrls: Array.from(state.exemptUrls),
        feedbackQueue: state.feedbackQueue.slice(-FEEDBACK_WINDOW),
        lastRunAt: state.lastRunAt,
      }, null, 2));
    }
    async function saveConfig() {
      await fsWrite(CONFIG_FILE, JSON.stringify(state.config, null, 2));
    }
    async function savePreferences() {
      await fsWrite(PREFERENCES_FILE, JSON.stringify(state.preferences, null, 2));
    }
    async function saveArchive() {
      const max = state.config.archiveMaxEntries || DEFAULT_ARCHIVE_MAX;
      if (state.archive.length > max) state.archive = state.archive.slice(-max);
      await fsWrite(HISTORY_FILE, state.archive.map((x) => JSON.stringify(x)).join('\n'));
    }

    async function loadAll() {
      const cfgText = await fsRead(CONFIG_FILE);
      state.config = mergeConfig(defaultConfig(), parseJson(cfgText, null));
      state.preferences = parseJson(await fsRead(PREFERENCES_FILE), defaultPreferences());
      if (!Array.isArray(state.preferences.block)) state.preferences.block = [];
      if (!Array.isArray(state.preferences.prefer)) state.preferences.prefer = [];
      if (!state.preferences.sourceWeights || typeof state.preferences.sourceWeights !== 'object') state.preferences.sourceWeights = {};
      const st = parseJson(await fsRead(STATE_FILE), null);
      state.cards = (st && Array.isArray(st.cards) ? st.cards : [])
        .filter((c) => c && c.url && (!c.read || c.feedback === 'dislike'))
        .map((c) => Object.assign({ relatedUrls: [], isNew: false, createdAt: Date.now() }, c, { isNew: false }));
      state.exemptUrls = new Set(st && Array.isArray(st.exemptUrls) ? st.exemptUrls : []);
      state.feedbackQueue = st && Array.isArray(st.feedbackQueue) ? st.feedbackQueue.slice(-FEEDBACK_WINDOW) : [];
      // 恢复上次成功采集时间（跨重启调度依据）：无效值忽略；未来时间（时钟回拨/跨机迁移）钳制到当前，
      // 避免「距上次采集为负」导致调度器永久跳过。
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
      state.retrying = 0;
      state.pendingRejected = [];
      state.cycleStamp = Date.now(); // 本轮刷新事件标识（分组/折叠依据）
      try {
        await loadAll();
        const stats = { scanned: 0, selected: 0, filtered: 0 };
        const candidates = [];
        for (const source of state.config.sources || []) {
          if (!source || !source.enabled) continue;
          try {
            state.progress = { stage: 'coarse', detail: String(source.name || source.id || ''), ts: Date.now() };
            const items = await stageCoarse(source);
            stats.scanned += items.length;
            state.progress = { stage: 'judge', detail: String(source.name || source.id || ''), ts: Date.now() };
            const picked = await stageJudge(source, items);
            stats.filtered += items.length - picked.length;
            stats.selected += picked.length;
            for (const it of picked) candidates.push({ item: it, source });
          } catch (err) {
            state.sourceErrors.push({ sourceId: String(source.id || ''), message: String((err && err.message) || err) });
            console.error('[dsh-livefeed] source failed:', source.id, err);
          }
        }
        if (candidates.length) {
          state.progress = { stage: 'cluster', detail: '', ts: Date.now() };
          const clusters = await stageCluster(candidates);
          const cards = await stageFineAndSummarizeAll(clusters);
          state.progress = { stage: 'land', detail: '', ts: Date.now() };
          await stageLand(cards);
        }
        // 被拒条目批量翻译标题后写入屏蔽日志（译文即数据）
        state.progress = { stage: 'translate', detail: String(state.pendingRejected.length), ts: Date.now() };
        await stageTranslateRejected();
        state.progress = { stage: 'rules', detail: '', ts: Date.now() };
        await stageRules();
        state.cycleStats = stats;
        state.lastError = undefined;
        state.lastRunAt = Date.now();
        state.tick += 1;
        await saveState(); // 顺序在 lastRunAt 之后：连同上次采集时间一并持久化（重启调度依据）
      } catch (err) {
        state.lastError = String((err && err.message) || err);
        console.error('[dsh-livefeed] cycle failed:', err);
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
        cards: state.cards.slice(-300).map((c) => ({
          id: c.id, title: c.title, summary: c.summary, url: c.url,
          sourceName: c.sourceName, publishedAt: c.publishedAt,
          relatedUrls: c.relatedUrls || [],
          isNew: !!c.isNew, read: !!c.read, feedback: c.feedback || null,
          createdAt: c.createdAt,
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
          maxCards: state.config.maxCards,
          maxCandidatesPerSource: state.config.maxCandidatesPerSource,
          maxCoarseItems: state.config.maxCoarseItems,
          summaryLanguage: state.config.summaryLanguage,
          interests: state.config.interests || [],
          blockWords: state.config.blockWords || [],
          archiveMaxEntries: state.config.archiveMaxEntries,
          model: state.config.model || null,
          sources: state.config.sources || [],
        } : null,
      }),
      'refresh': async () => {
        if (state.running) return { accepted: false };
        runCycle();
        return { accepted: true };
      },
      'mark': async (args) => {
        const a = args || {};
        const card = state.cards.find((c) => c.id === a.cardId);
        if (card) {
          if (a.read === true) { card.read = true; card.isNew = false; }
          if (a.feedback === 'dislike') {
            if (card.feedback !== 'dislike') {
              state.feedbackQueue.push({ title: card.title, url: card.url, ts: Date.now() });
              if (state.feedbackQueue.length > FEEDBACK_WINDOW) state.feedbackQueue.shift();
            }
            card.feedback = 'dislike';
            card.read = true;
            card.isNew = false;
          } else if (a.feedback === null) {
            card.feedback = null;
          }
          const key = normalizeUrl(card.url);
          const ae = state.archive.find((x) => normalizeUrl(x.url) === key);
          if (ae) ae.feedback = card.feedback;
          await saveState();
          await saveArchive();
        }
        return { ok: true };
      },
      'mark-all-read': async () => {
        let changed = false;
        for (const c of state.cards) {
          if (!c.read) { c.read = true; c.isNew = false; changed = true; }
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
        if (a.model !== undefined) {
          cfg.model = (a.model === null) ? null : {
            provider: String((a.model && a.model.provider) || ''),
            model: String((a.model && a.model.model) || ''),
            reasoningEffort: (a.model && a.model.reasoningEffort) || undefined,
          };
        }
        if (Array.isArray(a.interests)) cfg.interests = a.interests.map(String);
        if (Array.isArray(a.blockWords)) cfg.blockWords = a.blockWords.map(String);
        if (typeof a.archiveMaxEntries === 'number' && a.archiveMaxEntries >= 100) cfg.archiveMaxEntries = Math.round(a.archiveMaxEntries);
        if (typeof a.maxCoarseItems === 'number' && a.maxCoarseItems >= 1 && a.maxCoarseItems <= 100) cfg.maxCoarseItems = Math.round(a.maxCoarseItems);
        if (typeof a.maxCandidatesPerSource === 'number' && a.maxCandidatesPerSource >= 1 && a.maxCandidatesPerSource <= 20) cfg.maxCandidatesPerSource = Math.round(a.maxCandidatesPerSource);
        if (Array.isArray(a.sources)) {
          for (const s of a.sources) {
            const target = cfg.sources.find((x) => x.id === s.id);
            if (target) {
              if (typeof s.enabled === 'boolean') target.enabled = s.enabled;
              if (typeof s.query === 'string') target.query = s.query;
              // 源级阈值：数字覆盖全局；null 清除覆盖回退全局默认
              if (typeof s.maxItems === 'number') target.maxItems = Math.max(1, Math.min(100, Math.round(s.maxItems)));
              else if (s.maxItems === null) delete target.maxItems;
              if (typeof s.maxCandidates === 'number') target.maxCandidates = Math.max(1, Math.min(20, Math.round(s.maxCandidates)));
              else if (s.maxCandidates === null) delete target.maxCandidates;
            }
          }
        }
        state.config = cfg;
        await saveConfig();
        return { ok: true };
      },
      'update-words': async (args) => {
        const a = args || {};
        if (Array.isArray(a.interests)) state.config.interests = a.interests.map(String);
        if (Array.isArray(a.blockWords)) state.config.blockWords = a.blockWords.map(String);
        await saveConfig();
        return { ok: true };
      },
      'model-catalog': async () => {
        const providers = [];
        try {
          for (const p of ctx.llm.listProviders()) {
            let models = [];
            try { models = await ctx.llm.listModels(p.id); } catch (_) { models = []; }
            const modelEntries = [];
            for (const m of models) {
              const entry = { id: m.id, name: m.name, efforts: null };
              try {
                // 每个模型的思考等级来自其能力元数据（resolveModelInfo），不是全局固定列表
                const info = await ctx.llm.resolveModelInfo(p.id, m.id);
                if (info && info.reasoning && Array.isArray(info.reasoning.efforts) && info.reasoning.efforts.length) {
                  entry.efforts = info.reasoning.efforts.map((x) => ({ id: x.id, name: x.name }));
                }
              } catch (_) { /* 能力解析失败则无 efforts，客户端回退固定列表 */ }
              modelEntries.push(entry);
            }
            providers.push({ id: p.id, name: p.name, models: modelEntries });
          }
        } catch (_) { /* 目录失败返回空 */ }
        return { providers };
      },
      'rules': async () => jsonSafe({ rules: state.preferences }),
      'rerun-rules': async () => {
        if (state.running) return { accepted: false };
        runRerunRules();
        return { accepted: true };
      },
      'filter-log': async () => ({
        items: state.filterLog.slice(-FILTER_LOG_CAP).reverse(),
      }),
      'debug-log': async () => ({ items: requestLog.slice(-200).reverse() }),
      'unblock': async (args) => {
        const url = String((args && args.url) || '');
        if (!url) return { ok: false };
        const key = normalizeUrl(url);
        const log = state.filterLog.find((l) => normalizeUrl(l.url) === key);
        state.exemptUrls.add(key);
        state.seenUrls.add(key);
        // 撤销后从「被屏蔽内容」列表移除该条，避免「已撤销仍显示」的混淆
        state.filterLog = state.filterLog.filter((l) => normalizeUrl(l.url) !== key);
        const existing = state.cards.find((c) => normalizeUrl(c.url) === key);
        if (!existing) {
          state.cards.push({
            id: 'u' + Date.now().toString(36),
            title: log ? log.title : url,
            summary: '（已撤销屏蔽，暂以标题展示；下一周期将正常采集正文）',
            url,
            sourceName: log ? log.sourceId : '',
            read: false,
            feedback: null,
            isNew: true,
            createdAt: Date.now(),
            cycle: state.cycleStamp || Date.now(),
          });
        }
        await saveState();
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

      // HTTP API（bundle 模式客户端使用）
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
            // GET 诊断：/api/dsh-livefeed?method=model-catalog —— 浏览器地址栏可直接打开验证
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
      // 启动检查：距上次成功采集（持久化于 state.json 的 lastRunAt）不足间隔时跳过首轮采集，
      // 由后续 tick 在间隔到期后自动执行 —— 重启 dsh 不再每次都重复采集；
      // 距上次采集已超间隔（或从未采集过）时仍立即执行一轮。
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
        closeBrowserSession(); // 关闭可能仍在运行的离屏 Edge（异步即发即忘）
      };
    });
}
export { apply, inject, name };
