"""Unit tests for StreamCapture ffmpeg compatibility and retry handling."""

from app.services.camera_service import StreamCapture, STREAM_BACKOFF_INITIAL
import app.services.camera_service as camera_service_module


def test_start_ffmpeg_process_falls_back_from_fps_mode_to_vsync():
    capture = StreamCapture("https://example.com/live.m3u8")
    calls: list[list[str]] = []
    ok_process = object()

    def fake_spawn(mode_args: list[str]):
        calls.append(mode_args)
        if mode_args == []:
            return ok_process, ""
        return None, "should not pass extra ffmpeg mode args"

    capture._spawn_ffmpeg = fake_spawn  # type: ignore[method-assign]

    process, err = capture._start_ffmpeg_process()
    assert process is ok_process
    assert err == ""
    assert calls == [[]]


def test_start_ffmpeg_process_does_not_fallback_for_non_option_error():
    capture = StreamCapture("https://example.com/live.m3u8")
    calls: list[list[str]] = []

    def fake_spawn(mode_args: list[str]):
        calls.append(mode_args)
        return None, "Network timeout while opening input"

    capture._spawn_ffmpeg = fake_spawn  # type: ignore[method-assign]

    process, err = capture._start_ffmpeg_process()
    assert process is None
    assert err == "Network timeout while opening input"
    assert calls == [[]]


def test_start_respects_reset_retry_state_flag(monkeypatch):
    class _DummyPipe:
        def read(self, _n=-1):
            return b""

    class _DummyProcess:
        def __init__(self):
            self.stdout = _DummyPipe()
            self.stderr = _DummyPipe()

        def poll(self):
            return None

        def kill(self):
            return None

        def wait(self, timeout=None):
            return 0

    class _DummyThread:
        def __init__(self, *args, **kwargs):
            self._alive = False

        def start(self):
            self._alive = False

        def is_alive(self):
            return self._alive

        def join(self, timeout=None):
            return None

    monkeypatch.setattr(camera_service_module.threading, "Thread", _DummyThread)
    monkeypatch.setattr(camera_service_module.shutil, "which", lambda _bin: "/usr/bin/ffmpeg")

    capture = StreamCapture("https://example.com/live.m3u8")
    capture._start_ffmpeg_process = lambda: (_DummyProcess(), "")  # type: ignore[method-assign]

    capture._retry_count = 4
    capture._backoff = 123
    assert capture.start(reset_retry_state=False) is True
    assert capture._retry_count == 4
    assert capture._backoff == 123
    capture.stop()

    capture._started = False
    capture._retry_count = 4
    capture._backoff = 123
    assert capture.start(reset_retry_state=True) is True
    assert capture._retry_count == 0
    assert capture._backoff == STREAM_BACKOFF_INITIAL
    capture.stop()
