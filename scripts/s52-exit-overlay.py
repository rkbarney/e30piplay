#!/usr/bin/env python3
"""s52-exit-overlay — always-on-top "back to kiosk" button for the S52 panel.

The kiosk (Chromium) and the CarPlay receiver (react-carplay or LIVI) are
separate labwc toplevels. Whichever one is focused covers the whole panel and
swallows touch input, so there is no in-app way to get back to the kiosk once
the receiver has focus (see docs/tasks/exit-overlay-button.md). A
wlr-layer-shell surface is the standard wlroots fix: it always renders above
normal toplevels regardless of focus, and only claims input over its own
pixels — touches anywhere else fall through to whatever toplevel is focused
below.

Anchored top-center, since every kiosk screen (ScreenFrame.jsx) centers its
content with controls pinned at the bottom; the top strip is empty on all of
them. Tapping the button POSTs to the existing loopback-only
/api/return-to-kiosk endpoint (carplay-server.cjs), which already knows how to
minimize whichever receiver (react-carplay or LIVI) is currently focused.

Run by scripts/s52-labwc-autostart.sh as a fourth sibling labwc client.
"""
import urllib.error
import urllib.request

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('GtkLayerShell', '0.1')
from gi.repository import GLib, Gtk, GtkLayerShell  # noqa: E402

RETURN_TO_KIOSK_URL = 'http://127.0.0.1:3001/api/return-to-kiosk'
REQUEST_TIMEOUT_SEC = 5


def return_to_kiosk(button):
    button.set_sensitive(False)

    def worker():
        try:
            req = urllib.request.Request(RETURN_TO_KIOSK_URL, method='POST')
            urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC).close()
        except (urllib.error.URLError, OSError):
            pass
        GLib.idle_add(button.set_sensitive, True)

    GLib.Thread.new('return-to-kiosk', worker)


def main():
    window = Gtk.Window(title='s52-exit-overlay')
    window.set_decorated(False)
    window.set_default_size(64, 40)

    GtkLayerShell.init_for_window(window)
    GtkLayerShell.set_layer(window, GtkLayerShell.Layer.OVERLAY)
    GtkLayerShell.set_anchor(window, GtkLayerShell.Edge.TOP, True)
    GtkLayerShell.set_margin(window, GtkLayerShell.Edge.TOP, 4)
    GtkLayerShell.set_keyboard_mode(window, GtkLayerShell.KeyboardMode.NONE)

    button = Gtk.Button(label='⌂')  # house glyph
    button.connect('clicked', return_to_kiosk)
    button.set_size_request(64, 40)
    window.add(button)

    css = Gtk.CssProvider()
    css.load_from_data(b"""
        window { background-color: rgba(0, 0, 0, 0.35); }
        button {
            background: transparent;
            color: #ffb300;
            border: 1px solid rgba(255, 179, 0, 0.6);
            border-radius: 8px;
            font-size: 18px;
        }
    """)
    Gtk.StyleContext.add_provider_for_screen(
        window.get_screen(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
    )

    window.connect('destroy', Gtk.main_quit)
    window.show_all()
    Gtk.main()


if __name__ == '__main__':
    main()
