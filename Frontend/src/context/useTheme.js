import { useContext } from 'react'
import ThemeContext from './themeContext.js'

export function useTheme() {
    const context = useContext(ThemeContext)
    if (!context) throw new Error('useTheme должен использоваться внутри ThemeProvider')
    return context
}
