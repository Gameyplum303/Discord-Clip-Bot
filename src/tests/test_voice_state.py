import time
from unittest.mock import MagicMock

import pytest

from bot.voice_state import VoiceSessionState


@pytest.fixture
def state():
    return VoiceSessionState()


# ------------------------------------------------------------------
# Initial state
# ------------------------------------------------------------------

def test_initial_connection_fields_are_none(state):
    assert state.voice_client is None
    assert state.text_channel is None
    assert state.clips_channel is None


def test_initial_trigger_words_empty(state):
    assert state.get_trigger_words() == set()


def test_initial_cooldown_not_active(state):
    assert not state.is_on_cooldown()


def test_initial_not_connected(state):
    assert not state.is_connected()


# ------------------------------------------------------------------
# is_connected
# ------------------------------------------------------------------

def test_is_connected_false_when_voice_client_none(state):
    assert not state.is_connected()


def test_is_connected_delegates_to_voice_client(state):
    vc = MagicMock()
    vc.is_connected.return_value = True
    state.voice_client = vc
    assert state.is_connected()


def test_is_connected_false_when_voice_client_disconnected(state):
    vc = MagicMock()
    vc.is_connected.return_value = False
    state.voice_client = vc
    assert not state.is_connected()


# ------------------------------------------------------------------
# Trigger word management
# ------------------------------------------------------------------

def test_add_trigger_word_returns_true_for_new_word(state):
    assert state.add_trigger_word("hello") is True


def test_add_trigger_word_stores_word(state):
    state.add_trigger_word("hello")
    assert "hello" in state.get_trigger_words()


def test_add_trigger_word_normalises_case_and_whitespace(state):
    state.add_trigger_word("  HELLO  ")
    assert "hello" in state.get_trigger_words()


def test_add_trigger_word_duplicate_returns_false(state):
    state.add_trigger_word("hello")
    assert state.add_trigger_word("hello") is False


def test_add_trigger_word_duplicate_does_not_duplicate(state):
    state.add_trigger_word("hello")
    state.add_trigger_word("hello")
    assert len(state.get_trigger_words()) == 1


def test_remove_trigger_word_returns_true_when_present(state):
    state.add_trigger_word("hello")
    assert state.remove_trigger_word("hello") is True


def test_remove_trigger_word_deletes_word(state):
    state.add_trigger_word("hello")
    state.remove_trigger_word("hello")
    assert "hello" not in state.get_trigger_words()


def test_remove_trigger_word_returns_false_when_absent(state):
    assert state.remove_trigger_word("ghost") is False


def test_set_trigger_words_replaces_all(state):
    state.add_trigger_word("old")
    state.set_trigger_words({"new1", "new2"})
    assert state.get_trigger_words() == {"new1", "new2"}


def test_set_trigger_words_empty_clears_all(state):
    state.add_trigger_word("old")
    state.set_trigger_words(set())
    assert state.get_trigger_words() == set()


def test_get_trigger_words_returns_copy(state):
    state.add_trigger_word("hello")
    copy = state.get_trigger_words()
    copy.add("injected")
    assert "injected" not in state.get_trigger_words()


# ------------------------------------------------------------------
# Cooldown
# ------------------------------------------------------------------

def test_try_start_cooldown_first_call_succeeds(state):
    assert state.try_start_cooldown() is True


def test_try_start_cooldown_sets_cooldown_active(state):
    state.try_start_cooldown()
    assert state.is_on_cooldown()


def test_try_start_cooldown_second_call_fails(state):
    state.try_start_cooldown()
    assert state.try_start_cooldown() is False


def test_cooldown_expires_after_duration(state):
    state.cooldown_seconds = 0.05
    state.try_start_cooldown()
    assert state.is_on_cooldown()
    time.sleep(0.1)
    assert not state.is_on_cooldown()


def test_try_start_cooldown_succeeds_after_expiry(state):
    state.cooldown_seconds = 0.05
    state.try_start_cooldown()
    time.sleep(0.1)
    assert state.try_start_cooldown() is True


# ------------------------------------------------------------------
# active_clips_channel
# ------------------------------------------------------------------

def test_active_clips_channel_returns_dedicated_when_set(state):
    dedicated = MagicMock()
    state.clips_channel = dedicated
    state.text_channel = MagicMock()
    assert state.active_clips_channel is dedicated


def test_active_clips_channel_falls_back_to_text_channel(state):
    join_ch = MagicMock()
    state.text_channel = join_ch
    assert state.active_clips_channel is join_ch


def test_active_clips_channel_none_when_both_unset(state):
    assert state.active_clips_channel is None


# ------------------------------------------------------------------
# teardown
# ------------------------------------------------------------------

def test_teardown_clears_voice_client(state):
    state.voice_client = MagicMock()
    state.teardown()
    assert state.voice_client is None


def test_teardown_clears_text_channel(state):
    state.text_channel = MagicMock()
    state.teardown()
    assert state.text_channel is None


def test_teardown_preserves_clips_channel(state):
    ch = MagicMock()
    state.clips_channel = ch
    state.teardown()
    assert state.clips_channel is ch


def test_teardown_preserves_trigger_words(state):
    state.add_trigger_word("hello")
    state.teardown()
    assert "hello" in state.get_trigger_words()


def test_teardown_replaces_executor(state):
    original = state.executor
    state.teardown()
    assert state.executor is not original
