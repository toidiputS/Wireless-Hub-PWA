# ============================================================
#  Phone Keyboard — Windows SendInput Helper
#  Reads JSON commands from STDIN and injects keystrokes
#  using the Win32 SendInput API for maximum reliability.
# ============================================================

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NativeKeyboard
{
    // --- Win32 structs ---------------------------------------------------
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint   dwFlags;
        public uint   time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct HARDWAREINPUT
    {
        public uint   uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUT_UNION
    {
        [FieldOffset(0)] public MOUSEINPUT   mi;
        [FieldOffset(0)] public KEYBDINPUT   ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT
    {
        public uint       type;
        public INPUT_UNION u;
        internal static int Size { get { return Marshal.SizeOf(typeof(INPUT)); } }
    }

    // --- Constants -------------------------------------------------------
    const uint INPUT_MOUSE          = 0;
    const uint INPUT_KEYBOARD       = 1;
    const uint KEYEVENTF_KEYUP      = 0x0002;
    const uint KEYEVENTF_UNICODE    = 0x0004;

    // Mouse flags
    const uint MOUSEEVENTF_MOVE       = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    const uint MOUSEEVENTF_WHEEL      = 0x0800;

    // --- P/Invoke --------------------------------------------------------
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    // --- Mouse API -------------------------------------------------------
    public static void MoveMouse(int dx, int dy)
    {
        INPUT[] inputs = new INPUT[1];
        inputs[0].type          = INPUT_MOUSE;
        inputs[0].u.mi.dx      = dx;
        inputs[0].u.mi.dy      = dy;
        inputs[0].u.mi.dwFlags = MOUSEEVENTF_MOVE;
        SendInput(1, inputs, INPUT.Size);
    }

    public static void MouseClick(string button)
    {
        uint downFlag, upFlag;
        if (button == "right")       { downFlag = MOUSEEVENTF_RIGHTDOWN;  upFlag = MOUSEEVENTF_RIGHTUP; }
        else if (button == "middle") { downFlag = MOUSEEVENTF_MIDDLEDOWN; upFlag = MOUSEEVENTF_MIDDLEUP; }
        else                         { downFlag = MOUSEEVENTF_LEFTDOWN;   upFlag = MOUSEEVENTF_LEFTUP; }

        INPUT[] inputs = new INPUT[2];
        inputs[0].type          = INPUT_MOUSE;
        inputs[0].u.mi.dwFlags = downFlag;
        inputs[1].type          = INPUT_MOUSE;
        inputs[1].u.mi.dwFlags = upFlag;
        SendInput(2, inputs, INPUT.Size);
    }

    public static void MouseScroll(int delta)
    {
        INPUT[] inputs = new INPUT[1];
        inputs[0].type            = INPUT_MOUSE;
        inputs[0].u.mi.mouseData = (uint)delta;
        inputs[0].u.mi.dwFlags   = MOUSEEVENTF_WHEEL;
        SendInput(1, inputs, INPUT.Size);
    }

    // --- Keyboard API ----------------------------------------------------
    public static void SendVirtualKey(ushort vk)
    {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type     = INPUT_KEYBOARD;
        inputs[0].u.ki.wVk     = vk;
        inputs[0].u.ki.dwFlags = 0;
        inputs[1].type     = INPUT_KEYBOARD;
        inputs[1].u.ki.wVk     = vk;
        inputs[1].u.ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(2, inputs, INPUT.Size);
    }

    public static void KeyDown(ushort vk)
    {
        INPUT[] inputs    = new INPUT[1];
        inputs[0].type         = INPUT_KEYBOARD;
        inputs[0].u.ki.wVk     = vk;
        inputs[0].u.ki.dwFlags = 0;
        SendInput(1, inputs, INPUT.Size);
    }

    public static void KeyUp(ushort vk)
    {
        INPUT[] inputs    = new INPUT[1];
        inputs[0].type         = INPUT_KEYBOARD;
        inputs[0].u.ki.wVk     = vk;
        inputs[0].u.ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(1, inputs, INPUT.Size);
    }

    public static void SendUnicodeChar(char c)
    {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type          = INPUT_KEYBOARD;
        inputs[0].u.ki.wVk      = 0;
        inputs[0].u.ki.wScan    = (ushort)c;
        inputs[0].u.ki.dwFlags  = KEYEVENTF_UNICODE;
        inputs[1].type          = INPUT_KEYBOARD;
        inputs[1].u.ki.wVk      = 0;
        inputs[1].u.ki.wScan    = (ushort)c;
        inputs[1].u.ki.dwFlags  = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        SendInput(2, inputs, INPUT.Size);
    }

    public static void TypeString(string text)
    {
        if (text == null) return;
        foreach (char c in text) SendUnicodeChar(c);
    }
}
'@ -Language CSharp

# ============================================================
#  Main Loop — read one JSON command per line from STDIN
# ============================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8

$reader = New-Object System.IO.StreamReader(
    [Console]::OpenStandardInput(),
    [System.Text.Encoding]::UTF8
)

# Signal that the helper is ready
Write-Host "READY"

while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }

    try {
        $cmd = $line | ConvertFrom-Json

        switch ($cmd.action) {

            # ---- Type a string of Unicode text ----
            "type" {
                [NativeKeyboard]::TypeString($cmd.text)
            }

            # ---- Single virtual-key press + release ----
            "key" {
                [NativeKeyboard]::SendVirtualKey([uint16]$cmd.vk)
            }

            # ---- Key down (for modifiers) ----
            "keydown" {
                [NativeKeyboard]::KeyDown([uint16]$cmd.vk)
            }

            # ---- Key up (for modifiers) ----
            "keyup" {
                [NativeKeyboard]::KeyUp([uint16]$cmd.vk)
            }

            # ---- Modifier + key combo (e.g. Ctrl+C) ----
            "combo" {
                foreach ($mod in $cmd.modifiers) {
                    [NativeKeyboard]::KeyDown([uint16]$mod)
                }
                [NativeKeyboard]::SendVirtualKey([uint16]$cmd.key)
                # Release modifiers in reverse order
                $reversed = @($cmd.modifiers)
                [Array]::Reverse($reversed)
                foreach ($mod in $reversed) {
                    [NativeKeyboard]::KeyUp([uint16]$mod)
                }
            }

            # ---- N backspaces ----
            "backspace" {
                for ($i = 0; $i -lt $cmd.count; $i++) {
                    [NativeKeyboard]::SendVirtualKey(0x08)  # VK_BACK
                }
            }

            # ---- Diff-based edit (cursor moves + delete + type) ----
            "diff" {
                # Move cursor left to edit position
                for ($i = 0; $i -lt $cmd.leftMoves; $i++) {
                    [NativeKeyboard]::SendVirtualKey(0x25)  # VK_LEFT
                }
                # Delete old characters
                for ($i = 0; $i -lt $cmd.deleteCount; $i++) {
                    [NativeKeyboard]::SendVirtualKey(0x08)  # VK_BACK
                }
                # Insert new text (handle embedded newlines)
                if ($cmd.insertText) {
                    $segments = $cmd.insertText -split "(\r?\n)"
                    foreach ($seg in $segments) {
                        if ($seg -match '^\r?\n$') {
                            [NativeKeyboard]::SendVirtualKey(0x0D)  # VK_RETURN
                        } elseif ($seg.Length -gt 0) {
                            [NativeKeyboard]::TypeString($seg)
                        }
                    }
                }
                # Move cursor right to return to end
                for ($i = 0; $i -lt $cmd.rightMoves; $i++) {
                    [NativeKeyboard]::SendVirtualKey(0x27)  # VK_RIGHT
                }
            }

            # ---- Mouse move (relative) ----
            "mouse_move" {
                [NativeKeyboard]::MoveMouse([int]$cmd.dx, [int]$cmd.dy)
            }

            # ---- Mouse click ----
            "mouse_click" {
                $btn = if ($cmd.button) { $cmd.button } else { "left" }
                [NativeKeyboard]::MouseClick($btn)
            }

            # ---- Mouse scroll ----
            "mouse_scroll" {
                [NativeKeyboard]::MouseScroll([int]$cmd.delta)
            }
        }
    } catch {
        [Console]::Error.WriteLine("PS_ERROR: $($_.Exception.Message)")
    }
}
