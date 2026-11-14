import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "MemezSearch.js" as MemezSearch

// Memez for the Omarchy shell: the app's hotkey popup as a shell overlay.
// It reads the Memez library folder and never writes to it, so it works when
// the app is closed. Pastes are remembered in the plugin's own state file so
// recent memes come first, as in the app.
Item {
  id: root

  property var shell: null
  property var manifest: null

  property bool opened: false
  property string filterText: ""
  property int selectedIndex: 0
  property bool cursorActive: false

  property var memes: []
  property var recent: ({})
  // "" when the library loaded or is simply missing; otherwise why it could not be read.
  property string libraryError: ""
  // Ids of videos whose first-frame poster exists (see posters.sh).
  property var posterIds: ({})

  readonly property string home: Quickshell.env("HOME")
  // The app writes its library folder to config.json when it installs the plugin.
  property string configuredRoot: ""
  readonly property string libraryRoot: root.configuredRoot || Quickshell.env("MEMEZ_LIBRARY") || (root.home + "/Memez")
  readonly property string mediaDir: root.libraryRoot + "/media"
  readonly property string stateDir: (Quickshell.env("XDG_STATE_HOME") || (root.home + "/.local/state")) + "/memez"
  readonly property string posterDir: (Quickshell.env("XDG_CACHE_HOME") || (root.home + "/.cache")) + "/memez/omarchy-posters"
  readonly property string pluginDir: decodeURIComponent(String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "")).replace(/\/$/, "")

  // Shares the [menu] surface tokens, like the clipboard and emoji pickers.
  property color background: Commons.Color.menu.background
  property color foreground: Commons.Color.menu.text
  property color border: Commons.Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Commons.Color.menu.scrim
  property color selectedBackground: Commons.Color.menu.selectedBackground
  property color selectedText: Commons.Color.menu.selectedText
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int headerHeight: Math.max(Style.space(34), Style.font.title + Style.spacing.controlPaddingY * 2)
  property int footerHeight: Style.font.caption + Style.space(8)
  property int contentSpacing: Style.spacing.md
  property int cardWidth: Math.min(Style.space(920), panel.width - Style.gapsOut * 2)
  property int cardHeight: Math.min(Style.space(640), panel.height - Style.gapsOut * 2)
  property int columns: 5
  property int titleHeight: Style.font.body + Style.space(10)

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  function open(payloadJson) {
    root.opened = true
    root.filterText = ""
    root.selectedIndex = 0
    root.cursorActive = true
    pointerGate.reset()
    libraryFile.reload()
    root.rebuildDisplay()
    if (!posterProc.running) posterProc.running = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "memez")
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function loadLibrary(raw) {
    try {
      root.memes = MemezSearch.parseLibrary(raw)
      root.libraryError = ""
    } catch (e) {
      root.memes = []
      root.libraryError = String(e && e.message ? e.message : e)
    }
    if (!root.opened) return
    root.rebuildDisplay()
    // A video added while the overlay is open gets its poster now.
    if (!posterProc.running) posterProc.running = true
  }

  function rebuildDisplay() {
    var rows = MemezSearch.search(root.memes, root.filterText, root.recent, 500)
    displayModel.clear()
    for (var i = 0; i < rows.length; i++) {
      var meme = rows[i]
      displayModel.append({
        memeId: meme.id,
        kind: MemezSearch.mediaKind(meme.ext),
        title: meme.title,
        path: root.mediaDir + "/" + meme.id + "." + meme.ext
      })
    }
    if (displayModel.count === 0) selectedIndex = 0
    else if (selectedIndex >= displayModel.count) selectedIndex = displayModel.count - 1
    else if (selectedIndex < 0) selectedIndex = 0
    Qt.callLater(function() {
      if (displayModel.count > 0) resultGrid.positionViewAtIndex(root.selectedIndex, GridView.Contain)
    })
  }

  function setFilter(next) {
    root.filterText = next
    root.selectedIndex = 0
    root.cursorActive = true
    pointerGate.reset()
    root.rebuildDisplay()
  }

  function moveTo(index) {
    if (displayModel.count === 0) return
    pointerGate.reset()
    root.cursorActive = true
    root.selectedIndex = Math.max(0, Math.min(index, displayModel.count - 1))
    resultGrid.positionViewAtIndex(root.selectedIndex, GridView.Contain)
  }

  function select(delta) {
    if (displayModel.count === 0) return
    if (!root.cursorActive) root.moveTo(delta < 0 ? displayModel.count - 1 : 0)
    else root.moveTo((root.selectedIndex + delta + displayModel.count) % displayModel.count)
  }

  function selectRows(rows) {
    if (displayModel.count === 0) return
    root.moveTo(root.cursorActive ? root.selectedIndex + rows * root.columns : 0)
  }

  function visibleRows() {
    return Math.max(1, Math.floor(resultGrid.height / resultGrid.cellHeight))
  }

  function selectFromPointer(index, item, mouse) {
    if (!pointerGate.moved(item, mouse)) return
    root.cursorActive = true
    root.selectedIndex = index
  }

  function remember(id) {
    root.recent = MemezSearch.recordUse(root.recent, id, new Date().toISOString())
    recentFile.setText(JSON.stringify(root.recent) + "\n")
  }

  // mode: "paste", "copy" or "open".
  function useIndex(index, mode) {
    if (index < 0 || index >= displayModel.count) return
    var row = displayModel.get(index)
    var path = row.path
    if (mode !== "open") root.remember(row.memeId)
    root.dismiss()
    if (mode === "open") Quickshell.execDetached(["xdg-open", path])
    else if (mode === "copy") Quickshell.execDetached([root.pluginDir + "/paste.sh", "--copy-only", path])
    else Quickshell.execDetached([root.pluginDir + "/paste.sh", path])
  }

  function posterUrl(id) {
    return root.posterIds[id] ? Util.fileUrl(root.posterDir + "/" + id + ".jpg") : ""
  }

  function loadPosterIds(text) {
    var ids = ({})
    var lines = String(text || "").split("\n")
    for (var i = 0; i < lines.length; i++)
      if (/^[a-f0-9]{16}$/.test(lines[i])) ids[lines[i]] = true
    root.posterIds = ids
  }

  Component.onCompleted: mkdirProc.running = true

  ListModel { id: displayModel }

  PointerMoveGate {
    id: pointerGate
    referenceItem: card
  }

  FileView {
    path: root.pluginDir + "/config.json"
    watchChanges: true
    printErrors: false
    onLoaded: root.configuredRoot = MemezSearch.parseConfigRoot(text())
    onLoadFailed: root.configuredRoot = ""
    onFileChanged: reload()
  }

  FileView {
    id: libraryFile
    path: root.libraryRoot + "/library.json"
    watchChanges: true
    printErrors: false
    onLoaded: root.loadLibrary(text())
    // No library.json yet: the app has not saved a meme. Not an error.
    onLoadFailed: root.loadLibrary("{\"memes\":[]}")
    onFileChanged: reload()
  }

  FileView {
    id: recentFile
    path: root.stateDir + "/omarchy-recent.json"
    atomicWrites: true
    printErrors: false
    onLoaded: {
      root.recent = MemezSearch.parseRecent(text())
      if (root.opened) root.rebuildDisplay()
    }
  }

  Process {
    id: mkdirProc
    command: ["mkdir", "-p", root.stateDir]
  }

  Process {
    id: posterProc
    command: [root.pluginDir + "/posters.sh", root.libraryRoot, root.posterDir]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.loadPosterIds(text)
    }
  }

  OverlayWindow {
    id: panel
    shown: root.opened
    WlrLayershell.namespace: "memez"

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          var ctrlOnly = event.modifiers === Qt.ControlModifier
          if (event.key === Qt.Key_Escape) {
            if (root.filterText) root.setFilter("")
            else root.dismiss()
          } else if (Util.editsFilter(event, root.filterText)) {
            root.setFilter(Util.editedFilter(event, root.filterText))
          } else if (ctrlOnly && event.key >= Qt.Key_1 && event.key <= Qt.Key_9) {
            root.useIndex(event.key - Qt.Key_1, "paste")
          } else if (ctrlOnly && event.key === Qt.Key_C) {
            if (root.cursorActive) root.useIndex(root.selectedIndex, "copy")
          } else if (Util.readingKey(event) === Qt.Key_Left) {
            root.select(-1)
          } else if (Util.readingKey(event) === Qt.Key_Right) {
            root.select(1)
          } else if (event.key === Qt.Key_Up) {
            root.selectRows(-1)
          } else if (event.key === Qt.Key_Down) {
            root.selectRows(1)
          } else if (event.key === Qt.Key_PageUp) {
            root.selectRows(-root.visibleRows())
          } else if (event.key === Qt.Key_PageDown) {
            root.selectRows(root.visibleRows())
          } else if (event.key === Qt.Key_Home && ctrlOnly) {
            root.moveTo(0)
          } else if (event.key === Qt.Key_End && ctrlOnly) {
            root.moveTo(displayModel.count - 1)
          } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            if (!root.cursorActive) {
              if (displayModel.count > 0) root.cursorActive = true
            } else if (event.modifiers & Qt.AltModifier) root.useIndex(root.selectedIndex, "open")
            else if (event.modifiers & Qt.ShiftModifier) root.useIndex(root.selectedIndex, "copy")
            else root.useIndex(root.selectedIndex, "paste")
          } else if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127
                     && !(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier))) {
            root.setFilter(root.filterText + event.text)
          } else {
            return
          }
          event.accepted = true
        }
      }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: root.contentSpacing

        Item {
          width: parent.width
          height: root.headerHeight

          Text {
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.right: countText.left
            anchors.rightMargin: root.contentSpacing
            anchors.verticalCenter: parent.verticalCenter
            text: root.filterText || strings.t("search")
            color: root.foreground
            opacity: root.filterText ? 1 : 0.58
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
            elide: Text.ElideRight
          }

          Text {
            id: countText
            textFormat: Text.PlainText
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            visible: displayModel.count > 0
            text: root.filterText
              ? strings.tn("results", displayModel.count).arg(Commons.I18n.formatNumber(displayModel.count))
              : strings.t("recent")
            color: root.foreground
            opacity: 0.58
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }
        }

        Item {
          width: parent.width
          height: parent.height - root.headerHeight - root.footerHeight - root.contentSpacing * 2

          GridView {
            id: resultGrid
            anchors.fill: parent
            model: displayModel
            clip: true
            cellWidth: Math.floor(width / root.columns)
            cellHeight: cellWidth + root.titleHeight
            boundsBehavior: Flickable.StopAtBounds
            cacheBuffer: cellHeight * 2

            delegate: Item {
              id: tile
              required property int index
              required property string memeId
              required property string kind
              required property string title
              required property string path

              readonly property bool hasCursor: root.cursorActive && index === root.selectedIndex
              readonly property int inset: Style.space(4)

              width: resultGrid.cellWidth
              height: resultGrid.cellHeight

              Rectangle {
                anchors.fill: parent
                anchors.margins: Style.space(2)
                radius: root.cornerRadius
                color: tile.hasCursor ? root.selectedBackground : "transparent"
              }

              Item {
                id: thumb
                x: tile.inset
                y: tile.inset
                width: tile.width - tile.inset * 2
                height: tile.width - tile.inset * 2
                clip: true

                Rectangle {
                  anchors.fill: parent
                  radius: Math.max(0, root.cornerRadius - tile.inset)
                  color: Util.alpha(root.foreground, 0.06)
                }

                // Stills, the first frame of a GIF, and video posters.
                SizedImage {
                  anchors.fill: parent
                  visible: !(tile.kind === "gif" && tile.hasCursor)
                  url: !visible ? ""
                    : tile.kind === "video" ? root.posterUrl(tile.memeId)
                    : Util.fileUrl(tile.path)
                  asynchronous: true
                  smooth: true
                }

                // Only the selected GIF plays, so a grid of GIFs stays cheap.
                Loader {
                  anchors.fill: parent
                  active: tile.kind === "gif" && tile.hasCursor && root.opened
                  sourceComponent: AnimatedImage {
                    source: Util.fileUrl(tile.path)
                    fillMode: Image.PreserveAspectFit
                    asynchronous: true
                    smooth: true
                    playing: true
                  }
                }

                Rectangle {
                  visible: tile.kind !== "image"
                  anchors.left: parent.left
                  anchors.bottom: parent.bottom
                  anchors.margins: Style.space(6)
                  width: badge.implicitWidth + Style.space(10)
                  height: badge.implicitHeight + Style.space(4)
                  radius: height / 2
                  color: Util.alpha(root.background, 0.82)

                  Text {
                    id: badge
                    textFormat: Text.PlainText
                    anchors.centerIn: parent
                    text: tile.kind === "gif" ? strings.t("gif") : strings.t("video")
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                  }
                }

                Text {
                  visible: tile.index < 9
                  textFormat: Text.PlainText
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: Style.space(6)
                  text: String(tile.index + 1)
                  color: root.foreground
                  opacity: 0.5
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }
              }

              Text {
                textFormat: Text.PlainText
                x: tile.inset * 2
                y: thumb.y + thumb.height
                width: tile.width - tile.inset * 4
                height: root.titleHeight
                text: tile.title || strings.t("untitled")
                color: tile.hasCursor ? root.selectedText : root.foreground
                opacity: tile.title ? 1 : 0.58
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideRight
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onPositionChanged: function(mouse) { root.selectFromPointer(tile.index, tile, mouse) }
                onClicked: {
                  root.cursorActive = true
                  root.selectedIndex = tile.index
                  root.useIndex(tile.index, "paste")
                }
              }
            }
          }

          Column {
            anchors.centerIn: parent
            width: parent.width - 2 * root.contentMargin
            spacing: Style.space(8)
            visible: displayModel.count === 0

            Text {
              text: "󰈟"
              color: root.selectedText
              opacity: 0.8
              font.family: root.fontFamily
              font.pixelSize: Style.font.displayLarge
              horizontalAlignment: Text.AlignHCenter
              width: parent.width
            }

            Text {
              textFormat: Text.PlainText
              text: root.libraryError ? strings.t("badLibrary")
                : root.memes.length === 0 ? strings.t("empty")
                : strings.t("noMatches").arg(root.filterText)
              color: root.foreground
              opacity: 0.8
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              horizontalAlignment: Text.AlignHCenter
              width: parent.width
              elide: Text.ElideRight
            }

            Text {
              textFormat: Text.PlainText
              visible: !!root.libraryError || root.memes.length === 0
              text: root.libraryError ? root.libraryError : strings.t("emptyHint").arg(root.libraryRoot)
              color: root.foreground
              opacity: 0.58
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              horizontalAlignment: Text.AlignHCenter
              width: parent.width
              wrapMode: Text.Wrap
            }
          }
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          height: root.footerHeight
          text: strings.t("hints")
          color: root.foreground
          opacity: 0.5
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          horizontalAlignment: Text.AlignHCenter
          verticalAlignment: Text.AlignVCenter
          elide: Text.ElideRight
        }
      }
    }
  }
}
