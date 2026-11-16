/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Library Folder - The Memez library folder (the one with library.json) */
	"libraryFolder"?: string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Search Memes */
	export type SearchMemes = Omit<ExtensionPreferences, never> & {
		
	}

	/** Command: Add Meme from Clipboard */
	export type AddMeme = Omit<ExtensionPreferences, never> & {
		
	}
}

declare namespace ToolPreferences {
  
}

declare namespace Arguments {
  /** Command: Search Memes */
	export type SearchMemes = {
		
	}

	/** Command: Add Meme from Clipboard */
	export type AddMeme = {
		
	}
}