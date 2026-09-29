import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-client-ui-theme',
  ['lib/types/index.js'],
  {
    lib: {
      copy: [{
        from: 'src/styles/{brand-font.css,montserrat-*.woff2,Montserrat-OFL.txt,fonts.css}',
        to: 'lib/styles',
      }, {
        from: 'src/styles/fonts/*',
        to: 'lib/styles/fonts',
      }],
    },
  },
)
