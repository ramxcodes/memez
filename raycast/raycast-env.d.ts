/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Library Folder - The Memez library folder (the one with library.json) */
  "libraryFolder": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `search-memes` command */
  export type SearchMemes = ExtensionPreferences & {}
  /** Preferences accessible in the `add-meme` command */
  export type AddMeme = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `search-memes` command */
  export type SearchMemes = {}
  /** Arguments passed to the `add-meme` command */
  export type AddMeme = {}
}

