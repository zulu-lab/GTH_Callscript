[Federico]

# Torn Quick Bar – User Guide
A very simple guide for using the script.
This script adds a small quick bar to Torn so you can prepare help messages fast and paste them into chat with a long press.
---
# What the script does
The script adds 3 buttons:
- **C**
- **H**
- **•** (settings)
It works on:
- **Profile pages**
- **Attack pages**
Main idea:
- Tap a button once
- The script prepares the message for you
- Then you go to chat
- Do a **2 second long press**
- The prepared text gets pasted into chat
---
# What each button does
## C button
This is the **callout button**.
It creates this kind of message:
```text
! PlayerName in 5

Example:

! IamZulu in 5

Use it when you want to quickly warn or call a target by name.

Important:

* C is available on profile pages
* It reads the player name automatically from the profile you are viewing

⸻

H button

This is the help button.

It creates this kind of message:

! Help me https://www.torn.com/page.php?sid=attack&user2ID=XXXXX BSP:25m

It tries to include:

* the direct attack link
* the BSP/TBS value, if available

If BSP is not available, it still creates the help message without inventing values.

Use it when you want to quickly ask for help on a target.

Important:

* H works on profile pages
* H works on attack pages
* it uses the same API key already used by your BSP script

⸻

• button

This opens settings.

From settings you can:

* check or paste your API key
* enable or disable long press paste on chat
* on attack page, lock or unlock the floating bar position

⸻

Where the script appears

On profile pages

The bar is attached to the profile layout.

This means:

* it stays in a stable place
* it behaves more like a normal page element
* it does not need drag and drop there

On attack pages

The bar is floating.

This means:

* you can move it
* you can lock its position
* it stays where you put it

⸻

How to use it step by step

Basic use

1. Open a player profile or attack page
2. Tap C or H
3. Wait a moment for the script to prepare the message
4. Open the faction chat or another writable chat field
5. Do a long press for 2 seconds
6. The message gets pasted

That is the whole workflow.

⸻

Real example – C button

Goal

You want to send:

! MandoShark in 5

Steps

1. Open MandoShark profile
2. Tap C
3. The bar will show that it is armed
4. Go to your chat
5. Long press for 2 seconds inside the chat field
6. The message is inserted

⸻

Real example – H button from profile

Goal

You want to send a help request with link and BSP.

Steps

1. Open the player profile
2. Tap H
3. The script:
    * checks the API key if needed
    * fetches BSP if possible
    * builds the help message
4. Go to chat
5. Long press for 2 seconds
6. The message is inserted

Possible result:

! Help me https://www.torn.com/page.php?sid=attack&user2ID=3655681 BSP:144

⸻

Real example – H button from attack page

Goal

You are already on an attack page and want fast backup.

Steps

1. Open the attack page
2. Tap H
3. The script builds the help message using the current target
4. Go to chat
5. Long press for 2 seconds
6. The message is inserted

⸻

Settings explained

Open settings with the • button.

⸻

Primary API key

This is the Torn API key used by the script.

The script is designed to use the same key already used by BSP.

So in many cases:

* you do not need to type it again
* the script already sees it

If it is missing, paste it there and save.

⸻

Long press on chat = paste

This enables the main paste system.

When enabled:

* after you arm a message with C or H
* you can long press inside chat for 2 seconds
* the text is inserted

Recommended setting:

* leave this enabled

⸻

Lock position

This is only useful on the attack page.

When OFF

* the floating bar can be moved

When ON

* the floating bar stays where it is
* drag is disabled

Recommended workflow:

1. Move the bar where you want
2. Open settings
3. Enable Lock position
4. Save
5. Close settings

⸻

How drag and drop works

Drag and drop is only for the attack page floating bar.

To move it

1. Go to an attack page
2. Make sure Lock position is OFF
3. Touch and drag the bar
4. Drop it where you want

To keep it there

1. Open settings
2. Enable Lock position
3. Save

⸻

How the paste works

The paste action is not done on the button.

This is important.

Correct order

1. Tap C or H
2. The script prepares the message
3. Go to the chat input
4. Long press for 2 seconds on the chat input itself

So:

* tap button = prepare
* long press in chat = paste

Not the other way around.

⸻

What “armed” means

When the bar says something like:

Armed C

or

Armed H

it means:

* the message is ready
* the script is waiting for you to paste it into chat

It does not mean it has already been sent.

You still need to long press in the chat field.

⸻

What happens if BSP is missing

Sometimes the script cannot get BSP.

In that case:

* it does not invent values
* it still builds the help message
* it may just skip the BSP part

Example:

! Help me https://www.torn.com/page.php?sid=attack&user2ID=3655681

This is normal behavior.

⸻

What happens if API key is missing

If the script cannot find the key:

* H may return a message asking you to set or validate the API key
* open settings
* paste the same key used by BSP
* save

⸻

What happens if the API key is already stored by BSP

Usually this is the easiest case.

If BSP already uses a valid API key:

* this script can read that same key
* you often do not need to enter it again manually

That is why the guide says:

Use the same API key already used by BSP.

⸻

Troubleshooting

1. I tap H and nothing useful happens

Check:

* you are on a valid profile or attack page
* the player ID exists in the URL
* your API key is present
* the API key is valid

⸻

2. The message does not paste into chat

Check:

* the chat field is a real writable input
* “long press on chat = paste” is enabled
* you are holding for about 2 full seconds
* a message is actually armed first

Correct order again:

1. tap C or H
2. then long press inside chat

⸻

3. The bar moves on the attack page when I do not want it to

Open settings and:

* enable Lock position
* save

⸻

4. I cannot move the bar on attack page

Open settings and check:

* Lock position must be OFF

⸻

5. BSP does not show in the help message

Possible reasons:

* target has no result available
* API key is missing or not valid
* BSP backend did not return usable data
* cached data is not available yet

The help message can still work without BSP.

⸻

6. C does not use the correct player name

Check:

* you are on a real profile page
* the profile title has loaded properly

⸻

Best way to use the script

Fast profile workflow

1. Open player profile
2. Tap C or H
3. Open chat
4. Long press for 2 seconds
5. Send

Fast attack workflow

1. Open attack page
2. Move bar where comfortable
3. Lock position
4. Tap H
5. Open chat
6. Long press for 2 seconds
7. Send

⸻

Recommended setup

For profile page

* just use the anchored bar
* no special setup needed

For attack page

Recommended:

* place the bar where your thumb reaches easily
* enable Lock position
* leave long press on chat = paste enabled

⸻

Important behavior summary

C

Creates:

! Name in 5

H

Creates:

! Help me attack-link BSP:value

if BSP is available.

•

Opens settings.

Long press

Always do the long press on the chat input, not on the buttons.

⸻

Very short version

1. Tap C or H
2. Go to chat
3. Long press 2 seconds
4. Text gets pasted

⸻

Final notes

This script is built for:

* Torn mobile use
* quick touch workflow
* minimum visual clutter
* fast help/callout messaging

If something feels wrong, the first things to check are:

* correct page
* API key present
* message armed first
* long press done on the chat field

Zulu.
