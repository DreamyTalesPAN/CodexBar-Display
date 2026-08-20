Import("env")


link_flags = list(env.get("LINKFLAGS", []))
for symbol in ("_printf_float", "_scanf_float"):
    for index in range(len(link_flags) - 2, -1, -1):
        if link_flags[index] == "-u" and link_flags[index + 1] == symbol:
            del link_flags[index : index + 2]

env.Replace(LINKFLAGS=link_flags)
