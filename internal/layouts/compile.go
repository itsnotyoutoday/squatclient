package layouts

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

// Compiled is the result of compiling a layout.
type Compiled struct {
	Code string // CommonJS: require()s only "react" and "squat", default export is the layout component
	Lua  string // the <lua> block, for the engine
	CSS  string // the <style> block
}

// Compile turns a layout source into JavaScript the window can run. ext is the file extension
// (".layout", ".tsx", ".jsx", ".ts", ".js"). root is the layouts folder: a layout may import other files
// from inside it (and "react" and "squat", which the window provides), nothing else.
func Compile(name, ext, src, root string) (Compiled, error) {
	var c Compiled
	loader := api.LoaderTSX
	var lineMap []int
	switch ext {
	case ".layout":
		parts, err := Split(src)
		if err != nil {
			return c, fmt.Errorf("%s: %w", name, err)
		}
		src, lineMap = parts.TSX()
		c.Lua, c.CSS = parts.Lua, parts.CSS
	case ".tsx":
	case ".jsx":
		loader = api.LoaderJSX
	case ".ts":
		loader = api.LoaderTS
	case ".js":
		loader = api.LoaderJS
	default:
		return c, fmt.Errorf("%s: unsupported layout file type %q", name, ext)
	}
	absRoot, _ := filepath.Abs(root)
	res := api.Build(api.BuildOptions{
		Stdin:       &api.StdinOptions{Contents: src, Sourcefile: name + ext, ResolveDir: absRoot, Loader: loader},
		Bundle:      true,
		Format:      api.FormatCommonJS,
		Target:      api.ES2020,
		JSX:         api.JSXTransform, // React.createElement; React is in scope in the window
		Platform:    api.PlatformBrowser,
		Write:       false,
		LogLevel:    api.LogLevelSilent,
		Plugins:     []api.Plugin{sandbox(absRoot)},
		TreeShaking: api.TreeShakingFalse,
	})
	if len(res.Errors) > 0 {
		var msgs []string
		for _, m := range res.Errors {
			loc := name + ext
			if m.Location != nil {
				line, file := m.Location.Line, m.Location.File
				if file == "" || file == "<stdin>" || strings.HasSuffix(file, string(filepath.Separator)+name+ext) || file == name+ext {
					file = name + ext
					if lineMap != nil && line >= 1 && line <= len(lineMap) {
						if o := lineMap[line-1]; o > 0 {
							line = o
						}
					}
				} else if rel, err := filepath.Rel(absRoot, file); err == nil && !strings.HasPrefix(rel, "..") {
					file = rel // another file of the layouts folder
				}
				loc = fmt.Sprintf("%s:%d:%d", file, line, m.Location.Column+1)
			}
			msgs = append(msgs, loc+": "+m.Text)
		}
		return c, errors.New(strings.Join(msgs, "\n"))
	}
	if len(res.OutputFiles) != 1 {
		return c, errors.New("compiler produced no output")
	}
	c.Code = string(res.OutputFiles[0].Contents)
	return c, nil
}

// sandbox limits what a layout can import: "react" and "squat" are provided by the window, relative
// files must resolve inside the layouts folder, anything else is an error.
func sandbox(root string) api.Plugin {
	return api.Plugin{
		Name: "layout-sandbox",
		Setup: func(b api.PluginBuild) {
			b.OnResolve(api.OnResolveOptions{Filter: `.*`}, func(a api.OnResolveArgs) (api.OnResolveResult, error) {
				switch a.Path {
				case "react", "squat":
					return api.OnResolveResult{Path: a.Path, External: true}, nil
				}
				if !strings.HasPrefix(a.Path, ".") && !filepath.IsAbs(a.Path) {
					return api.OnResolveResult{}, fmt.Errorf("a layout cannot import %q (only \"react\", \"squat\" and files in the layouts folder)", a.Path)
				}
				p := a.Path
				if !filepath.IsAbs(p) {
					p = filepath.Join(a.ResolveDir, p)
				}
				p = filepath.Clean(p)
				if p != root && !strings.HasPrefix(p, root+string(filepath.Separator)) {
					return api.OnResolveResult{}, fmt.Errorf("%q is outside the layouts folder", a.Path)
				}
				return api.OnResolveResult{}, nil // let esbuild resolve it (extensions, index files)
			})
		},
	}
}
