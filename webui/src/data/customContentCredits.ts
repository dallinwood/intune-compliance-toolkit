export interface CustomContentCredit {
  name: string
  url: string
  commit: string
  licenceName: string
  licenceUrl: string
}

// Mirrors the Blueprint section of the repository's NOTICE file.
export const CUSTOM_CONTENT_CREDITS: CustomContentCredit[] = [
  {
    name: "ASD's Blueprint for Secure Cloud",
    url: 'https://github.com/ASD-Blueprint/ASD-Blueprint-for-Secure-Cloud',
    commit: 'a6e1e5f95e6051f23d2e7d1148c8fd57a6614000',
    licenceName: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
]
