# File Description: Runs a command under a real pseudo-terminal, answers its prompts in order and reports how it ended.
# Inputs and outputs: argv (events file, JSON steps, "--", command...) -> one JSON line on stdout with exit status and terminal output.
# Used by: backend/aideosLauncherMenuFirst.test.ts (drives bin/aideos exactly as a user at a terminal would).

import json
import os
import pty
import select
import signal
import sys
import time

TOTAL_TIMEOUT_SECONDS = 40.0


# Appends one marker line to the shared events file so tests can order terminal events against shim events.
def mark(events_path, text):
    with open(events_path, "a") as handle:
        handle.write(text + "\n")


# Reads whatever the terminal has produced within the wait, returning "" when nothing arrived or the child hung up.
def read_chunk(fd, wait):
    ready, _, _ = select.select([fd], [], [], wait)
    if not ready:
        return ""
    try:
        return os.read(fd, 65536).decode("utf-8", "replace")
    except OSError:
        return None


# Converts a waitpid status into a shell-style exit code (128 + signal for a signalled child).
def exit_code(status):
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return -1


# Spawns the command on a pty, plays the steps (wait for text, settle, mark, send keys) and prints the result as JSON.
def main():
    events_path = sys.argv[1]
    steps = json.loads(sys.argv[2])
    command = sys.argv[sys.argv.index("--") + 1:]
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(command[0], command)
    output = ""
    consumed = 0
    deadline = time.time() + TOTAL_TIMEOUT_SECONDS
    timed_out = False
    closed = False
    for step in steps:
        while step["expect"] not in output[consumed:]:
            if time.time() > deadline:
                timed_out = True
                break
            chunk = read_chunk(fd, 0.1)
            if chunk is None:
                closed = True
                break
            output += chunk
        if timed_out or closed:
            break
        consumed = output.rindex(step["expect"]) + len(step["expect"])
        time.sleep(step.get("settle", 0.5))
        output += read_chunk(fd, 0) or ""
        if step.get("mark"):
            mark(events_path, step["mark"])
        os.write(fd, step["send"].encode())
    while not timed_out and not closed:
        if time.time() > deadline:
            timed_out = True
            break
        chunk = read_chunk(fd, 0.1)
        if chunk is None:
            closed = True
        else:
            output += chunk
    if timed_out:
        os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
    print(json.dumps({"status": exit_code(status), "timedOut": timed_out, "output": output}))


main()
