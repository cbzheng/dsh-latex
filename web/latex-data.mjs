// Completion vocabulary. A spec is a command name followed by its argument groups;
// text inside a group becomes a placeholder: frac{num}{den}, sqrt[n]{}.
const list=text=>text.trim().split(/\s+/);
// Offered first on a bare backslash, in this order.
export const FREQUENT=list(`section{} subsection{} textbf{} emph{} cite{} ref{} label{} begin{} item includegraphics[width=\\linewidth]{} caption{} footnote{} textit{} subsubsection{} paragraph{} autoref{} input{} usepackage{} centering texttt{}`);
export const COMMANDS=list(`
part{} chapter{} section*{} subsection*{} subsubsection*{} subparagraph{} appendix tableofcontents listoffigures listoftables maketitle title{} author{} date{} thanks{} today
underline{} textsc{} textsf{} textrm{} textsl{} textup{} textmd{} textnormal{} textsuperscript{} textsubscript{} footnotemark footnotetext{} marginpar{} mbox{} fbox{} parbox{width}{text} makebox[width]{text} raisebox{lift}{text} verb
tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge bfseries itshape scshape ttfamily sffamily rmfamily mdseries upshape slshape normalfont
eqref{} pageref{} nameref{} nocite{} bibliography{} bibliographystyle{} bibitem{} end{} item[label]
documentclass{} documentclass[options]{class} usepackage[options]{package} RequirePackage{} newcommand{\\name}{definition} newcommand{\\name}[1]{definition} renewcommand{\\name}{definition} providecommand{\\name}{definition} newenvironment{name}{begin}{end} renewenvironment{name}{begin}{end} newtheorem{name}{Title} newcounter{} setcounter{counter}{value} addtocounter{counter}{value} stepcounter{} refstepcounter{} setlength{\\length}{value} addtolength{\\length}{value} newlength{} include{} includeonly{} pagestyle{} thispagestyle{} pagenumbering{} linespread{} makeatletter makeatother AtBeginDocument{} newif
vspace{} hspace{} vspace*{} hspace*{} smallskip medskip bigskip vfill hfill quad qquad noindent indent par newline linebreak pagebreak nolinebreak nopagebreak newpage clearpage cleardoublepage phantom{} vphantom{} hphantom{} raggedright raggedleft textwidth linewidth columnwidth textheight baselineskip parindent parskip tabcolsep arraystretch
hline cline{} multicolumn{columns}{alignment}{text} tabularnewline
frac{num}{den} sqrt{} sqrt[n]{} sum prod int iint iiint oint lim limits nolimits infty partial nabla cdot cdots ldots dots vdots ddots times div pm mp leq geq neq approx equiv sim simeq cong propto ll gg subset supset subseteq supseteq in notin ni cup cap setminus emptyset varnothing forall exists nexists neg land lor wedge vee oplus otimes odot to rightarrow leftarrow Rightarrow Leftarrow leftrightarrow Leftrightarrow mapsto longrightarrow longleftarrow Longrightarrow hookrightarrow implies iff uparrow downarrow updownarrow nearrow searrow
left right big Big bigg Bigg middle langle rangle lfloor rfloor lceil rceil lvert rvert lVert rVert
mathbf{} mathrm{} mathit{} mathcal{} mathsf{} mathtt{} mathnormal{} hat{} bar{} tilde{} vec{} dot{} ddot{} check{} breve{} acute{} grave{} overline{} widehat{} widetilde{} overbrace{} underbrace{} overset{above}{base} underset{below}{base} stackrel{above}{base} binom{n}{k}
sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg exp min max arg sup inf det dim ker gcd Pr deg hom limsup liminf bmod pmod{} mod
nonumber displaystyle textstyle scriptstyle scriptscriptstyle prime ell hbar Re Im aleph star ast circ bullet dagger ddagger angle perp parallel mid nmid top bot triangle square diamond clubsuit heartsuit spadesuit flat sharp natural surd wp imath jmath smile frown vdash dashv models
alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
LaTeX TeX textbackslash textasciitilde textasciicircum textbar textless textgreater textquotedblleft textquotedblright textendash textemdash textbullet textdegree textregistered texttrademark copyright pounds dag ddag S P i j o O l L ss ae AE aa AA
`);
// Offered when the class or package is loaded in the project.
export const PACKAGE_COMMANDS={
 amsmath:list(`text{} dfrac{num}{den} tfrac{num}{den} boldsymbol{} operatorname{} DeclareMathOperator{\\name}{text} notag tag{} substack{} intertext{} eqref{} dots dotsc dotsb xrightarrow{} xleftarrow{} lvert rvert`),
 amssymb:list(`mathbb{} mathfrak{} therefore because leqslant geqslant lesssim gtrsim nsubseteq subsetneq supsetneq blacksquare square checkmark complement nexists varnothing ltimes rtimes`),
 amsthm:list(`theoremstyle{} qedhere qed proofname`),
 bm:list(`bm{}`),
 graphicx:list(`includegraphics{} graphicspath{{}} rotatebox{angle}{text} scalebox{scale}{text} resizebox{width}{height}{text}`),
 xcolor:list(`textcolor{color}{text} color{} colorbox{color}{text} fcolorbox{frame}{background}{text} definecolor{name}{RGB}{r,g,b} pagecolor{}`),
 hyperref:list(`url{} href{url}{text} autoref{} hyperref[label]{text} hypersetup{} nolinkurl{} texorpdfstring{tex}{pdf} phantomsection`),
 url:list(`url{}`),
 cleveref:list(`cref{} Cref{} crefrange{first}{last} cpageref{} namecref{} labelcref{} crefname{type}{singular}{plural}`),
 natbib:list(`citep{} citet{} citealp{} citealt{} citeauthor{} citeyear{} citeyearpar{} citep[prenote][postnote]{} setcitestyle{}`),
 biblatex:list(`parencite{} textcite{} autocite{} footcite{} fullcite{} citeauthor{} citeyear{} citetitle{} addbibresource{} printbibliography nocite{}`),
 booktabs:list(`toprule midrule bottomrule cmidrule{} cmidrule(lr){} addlinespace`),
 multirow:list(`multirow{rows}{*}{text}`),
 makecell:list(`makecell{} thead{}`),
 tabularx:list(`tabularxcolumn`),
 subcaption:list(`subcaption{} subcaptionbox{caption}{content} subref{}`),
 caption:list(`captionsetup{} caption*{} captionof{type}{text}`),
 enumitem:list(`setlist{} setlist[itemize]{}`),
 siunitx:list(`qty{number}{unit} num{} unit{} SI{number}{unit} si{} qtyrange{from}{to}{unit} numrange{from}{to} ang{} sisetup{}`),
 soul:list(`hl{} st{} ul{} so{} sethlcolor{}`),
 ulem:list(`sout{} uline{} uwave{} xout{} uuline{}`),
 todonotes:list(`todo{} todo[inline]{} missingfigure{} listoftodos`),
 changes:list(`added{} deleted{} replaced{new}{old} highlight{} comment{} added[id=AI]{} deleted[id=AI]{} replaced[id=AI]{new}{old} comment[id=AI]{} listofchanges definechangesauthor[name={},color=blue]{id}`),
 listings:list(`lstinline lstinputlisting{} lstset{} lstdefinestyle{name}{options}`),
 minted:list(`mintinline{language}{code} inputminted{language}{file} setminted{}`),
 algorithm2e:list(`KwIn{} KwOut{} KwData{} KwResult{} For{condition}{body} While{condition}{body} If{condition}{body} eIf{condition}{then}{else} Return{} SetAlgoLined`),
 algpseudocode:list(`State Require Ensure If{} ElsIf{} Else EndIf For{} EndFor While{} EndWhile Return Function{name}{args} EndFunction Call{name}{args} Comment{}`),
 tikz:list(`draw node path fill coordinate tikzset{} usetikzlibrary{} foreach clip filldraw`),
 xspace:list(`xspace`),
 geometry:list(`geometry{} newgeometry{} restoregeometry`),
 fancyhdr:list(`fancyhead{} fancyfoot{} fancyhf{} lhead{} chead{} rhead{} lfoot{} cfoot{} rfoot{}`),
 setspace:list(`singlespacing onehalfspacing doublespacing setstretch{}`),
 subfiles:list(`subfile{} subfileinclude{}`),
 threeparttable:list(`tnote{}`),
 pifont:list(`ding{} cmark xmark`),
 acmart:list(`affiliation{} institution{} city{} state{} country{} department{} streetaddress{} postcode{} email{} orcid{} authornote{} authornotemark[1] additionalaffiliation{} shortauthors ccsdesc[500]{} keywords{} setcopyright{} copyrightyear{} acmYear{} acmDOI{} acmISBN{} acmConference[short]{name}{date}{venue} acmJournal{} acmVolume{} acmNumber{} acmArticle{} acmMonth{} received{} received[revised]{} received[accepted]{} citestyle{} Description{} anon{} acmBooktitle{} acmSubmissionID{} settopmatter{} textcolor{color}{text} citep{} citet{} citeauthor{} citeyear{} toprule midrule bottomrule url{} href{url}{text} autoref{} includegraphics{}`),
 'sn-jnl':list(`fnm{} sur{} spfx{} affil[1]{} affil*[1]{} author[1]{} author*[1]{} orgdiv{} orgname{} orgaddress{} street{} city{} postcode{} state{} country{} email{} equalcont{} abstract{} keywords{} pacs[JEL Classification]{} bmhead{} backmatter botrule toprule midrule footnotetext{} citep{} citet{} url{} includegraphics{} textcolor{color}{text}`),
 beamer:list(`frametitle{} framesubtitle{} pause onslide<1->{} only<1>{} uncover<1->{} alert{} usetheme{} usecolortheme{} titlepage institute{} subtitle{} includegraphics{} textcolor{color}{text}`)
};
export const SYMBOLS=Object.fromEntries(`alpha α beta β gamma γ delta δ epsilon ϵ varepsilon ε zeta ζ eta η theta θ vartheta ϑ iota ι kappa κ lambda λ mu μ nu ν xi ξ pi π varpi ϖ rho ρ varrho ϱ sigma σ varsigma ς tau τ upsilon υ phi ϕ varphi φ chi χ psi ψ omega ω Gamma Γ Delta Δ Theta Θ Lambda Λ Xi Ξ Pi Π Sigma Σ Upsilon Υ Phi Φ Psi Ψ Omega Ω
sum ∑ prod ∏ int ∫ iint ∬ iiint ∭ oint ∮ infty ∞ partial ∂ nabla ∇ cdot · cdots ⋯ ldots … vdots ⋮ ddots ⋱ times × div ÷ pm ± mp ∓ leq ≤ geq ≥ neq ≠ approx ≈ equiv ≡ sim ∼ simeq ≃ cong ≅ propto ∝ ll ≪ gg ≫ subset ⊂ supset ⊃ subseteq ⊆ supseteq ⊇ in ∈ notin ∉ ni ∋ cup ∪ cap ∩ setminus ∖ emptyset ∅ varnothing ∅ forall ∀ exists ∃ nexists ∄ neg ¬ land ∧ lor ∨ wedge ∧ vee ∨ oplus ⊕ otimes ⊗ odot ⊙ to → rightarrow → leftarrow ← Rightarrow ⇒ Leftarrow ⇐ leftrightarrow ↔ Leftrightarrow ⇔ mapsto ↦ longrightarrow ⟶ longleftarrow ⟵ Longrightarrow ⟹ hookrightarrow ↪ implies ⟹ iff ⟺ uparrow ↑ downarrow ↓ updownarrow ↕ nearrow ↗ searrow ↘ langle ⟨ rangle ⟩ lfloor ⌊ rfloor ⌋ lceil ⌈ rceil ⌉ prime ′ ell ℓ hbar ℏ Re ℜ Im ℑ aleph ℵ star ⋆ ast ∗ circ ∘ bullet • dagger † ddagger ‡ angle ∠ perp ⊥ parallel ∥ mid ∣ nmid ∤ top ⊤ bot ⊥ triangle △ square □ diamond ⋄ surd √ wp ℘ vdash ⊢ dashv ⊣ models ⊨ therefore ∴ because ∵ leqslant ⩽ geqslant ⩾ checkmark ✓ blacksquare ■ complement ∁ sqrt √ textbullet • textdegree ° copyright © pounds £ textendash – textemdash — dag † ddag ‡ S § P ¶ ss ß ae æ AE Æ aa å AA Å o ø O Ø`.trim().split(/\s+/).reduce((pairs,item,index,all)=>index%2?pairs:[...pairs,[item,all[index+1]]],[]));
export const ENVIRONMENTS=list(`document abstract figure figure* table table* tabular tabular* itemize enumerate description equation equation* align align* gather gather* multline multline* eqnarray split cases matrix pmatrix bmatrix vmatrix Vmatrix array center flushleft flushright quote quotation verse verbatim minipage titlepage thebibliography theorem lemma proof corollary proposition definition remark example`);
export const PACKAGE_ENVIRONMENTS={
 amsmath:list(`aligned gathered alignat alignat* flalign flalign* subequations smallmatrix`),
 tabularx:list(`tabularx`),longtable:list(`longtable`),threeparttable:list(`threeparttable tablenotes`),subcaption:list(`subfigure subtable`),
 tikz:list(`tikzpicture scope`),listings:list(`lstlisting`),minted:list(`minted`),algorithm:list(`algorithm`),algorithm2e:list(`algorithm`),algpseudocode:list(`algorithmic`),algorithmic:list(`algorithmic`),
 multicol:list(`multicols`),wrapfig:list(`wrapfigure`),rotating:list(`sidewaysfigure sidewaystable`),appendix:list(`appendices`),framed:list(`framed shaded`),mdframed:list(`mdframed`),tcolorbox:list(`tcolorbox`),comment:list(`comment`),
 acmart:list(`acks teaserfigure CCSXML anonsuppress`),'sn-jnl':list(`appendices`),beamer:list(`frame columns column block alertblock exampleblock`)
};
// Environment bodies; ${} marks a stop. Others get an empty body.
export const ENVIRONMENT_BODIES={
 figure:'[htbp]\n\t\\centering\n\t\\includegraphics[width=\\linewidth]{${}}\n\t\\caption{${}}\n\t\\label{fig:${}}',
 'figure*':'[htbp]\n\t\\centering\n\t\\includegraphics[width=\\linewidth]{${}}\n\t\\caption{${}}\n\t\\label{fig:${}}',
 teaserfigure:'\n\t\\includegraphics[width=\\textwidth]{${}}\n\t\\caption{${}}\n\t\\Description{${}}\n\t\\label{fig:teaser}',
 table:'[htbp]\n\t\\centering\n\t\\caption{${}}\n\t\\label{tab:${}}\n\t\\begin{tabular}{${lcc}}\n\t\t\\hline\n\t\t${} \\\\\n\t\t\\hline\n\t\\end{tabular}',
 'table*':'[htbp]\n\t\\centering\n\t\\caption{${}}\n\t\\label{tab:${}}\n\t\\begin{tabular}{${lcc}}\n\t\t\\hline\n\t\t${} \\\\\n\t\t\\hline\n\t\\end{tabular}',
 tabular:'{${lcc}}\n\t${}',tabularx:'{\\linewidth}{${lXX}}\n\t${}','tabular*':'{\\linewidth}{${lcc}}\n\t${}',array:'{${cc}}\n\t${}',
 itemize:'\n\t\\item ${}',enumerate:'\n\t\\item ${}',description:'\n\t\\item[${}] ${}',
 equation:'\n\t${}\n\t\\label{eq:${}}',minipage:'{${0.48\\linewidth}}\n\t${}',thebibliography:'{99}\n\t\\bibitem{${}} ${}',
 subfigure:'[b]{${0.48\\linewidth}}\n\t\\centering\n\t\\includegraphics[width=\\linewidth]{${}}\n\t\\caption{${}}\n\t\\label{fig:${}}',
 frame:'{${}}\n\t${}',columns:'\n\t\\begin{column}{0.5\\textwidth}\n\t\t${}\n\t\\end{column}',multicols:'{2}\n\t${}',wrapfigure:'{r}{${0.4\\linewidth}}\n\t\\centering\n\t\\includegraphics[width=\\linewidth]{${}}\n\t\\caption{${}}'
};
export const PACKAGES=list(`amsmath amssymb amsthm amsfonts mathtools bm graphicx xcolor hyperref url cleveref natbib biblatex booktabs multirow makecell tabularx longtable array colortbl threeparttable subcaption caption float wrapfig rotating enumitem siunitx soul ulem todonotes changes listings minted algorithm algorithm2e algpseudocode algorithmic tikz pgfplots xspace geometry fancyhdr setspace subfiles pifont inputenc fontenc babel csquotes microtype lmodern times helvet courier mathptmx newtxtext newtxmath fontspec xeCJK ctex CJKutf8 multicol appendix lipsum blindtext verbatim comment framed mdframed tcolorbox titlesec titling tocloft parskip indentfirst ragged2e footmisc lineno authblk balance flushend dblfloatfix stfloats placeins afterpage pdfpages pdflscape lscape adjustbox graphbox epstopdf svg textcomp upquote nicefrac xfrac cancel physics esint mathrsfs dsfont bbm stmaryrd wasysym marvosym fontawesome5 academicons orcidlink doi hyphenat xparse etoolbox ifthen calc xstring import standalone`);
export const CLASSES=list(`article report book letter memoir beamer standalone acmart sn-jnl IEEEtran llncs elsarticle revtex4-2 amsart scrartcl scrreprt scrbook ctexart ctexrep ctexbook extarticle`);
export const BIBSTYLES=list(`plain abbrv alpha unsrt ieeetr acm apalike plainnat abbrvnat unsrtnat IEEEtran ACM-Reference-Format sn-nature sn-basic sn-mathphys-num sn-mathphys-ay sn-vancouver-num sn-aps`);
