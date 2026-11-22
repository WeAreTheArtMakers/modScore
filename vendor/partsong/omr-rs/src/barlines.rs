//! modScore 2026-11-22: conservative image evidence for connected piano barlines.
//! A stem cannot span the complete gap between two staves. Only narrow, nearly
//! continuous vertical strokes across both five-line staves and their gap qualify.
//! Skewed, broken, single-staff and uncertain cases keep the model's interpretation.
use homr_rs::{staff::Staff, warp::Gray};

pub fn connected_barlines(image: &Gray, staff: &Staff) -> Vec<f64> {
    let Some((upper, lower)) = staff.halves.as_deref() else { return vec![]; };
    let unit = (upper.max_y - upper.min_y) / 4.0;
    if unit < 3.0 || lower.min_y <= upper.max_y { return vec![]; }
    let left = (upper.min_x.max(lower.min_x) + 2.0 * unit).ceil().max(2.0) as usize;
    let right = (upper.max_x.min(lower.max_x) - 2.0 * unit).floor().min((image.w - 2) as f64) as usize;
    let top = upper.min_y.ceil().max(0.0) as usize;
    let bottom = lower.max_y.floor().min((image.h - 1) as f64) as usize;
    if right <= left || bottom <= top { return vec![]; }
    let mut runs: Vec<(usize, usize)> = vec![];
    let mut start = None;
    for x in left..=right {
        let mut ink = 0;
        let mut gap = 0;
        let mut longest_gap = 0;
        for y in top..=bottom {
            if (x-1..=x+1).any(|xx| image.at(xx, y) < 100) { ink += 1; gap = 0; }
            else { gap += 1; longest_gap = longest_gap.max(gap); }
        }
        let qualifies = ink as f64 >= (bottom-top+1) as f64 * 0.96 && longest_gap <= 3;
        if qualifies && start.is_none() { start = Some(x); }
        if (!qualifies || x == right) && start.is_some() {
            let first = start.take().unwrap();
            let last = if qualifies { x+1 } else { x };
            if (last-first) as f64 <= unit * 0.65 { runs.push((first,last)); }
        }
    }
    let mut result: Vec<f64> = vec![];
    for (a,b) in runs {
        let x = (a+b-1) as f64 / 2.0;
        if result.last().is_none_or(|last| x-last > unit) { result.push(x); }
    }
    result
}

/// A full barline count is a second, independent guard against attention drift.
pub fn missing_boundary_budget(internal_lines: usize, symbols: &[homr_rs::tokens::Symbol]) -> usize {
    let mut measures = 0;
    let mut open = false;
    for s in symbols {
        if s.rhythm.starts_with("note") || s.rhythm.starts_with("rest") { open = true; }
        else if (s.rhythm.contains("barline") || s.rhythm.starts_with("repeat")) && open {
            measures += 1; open = false;
        }
    }
    measures += open as usize;
    if measures == 0 { 0 } else { (internal_lines+1).saturating_sub(measures) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use homr_rs::staff::StaffPoint;
    fn line(y: f64) -> Staff {
        Staff::from_grid([10.0,210.0].into_iter().map(|x| StaffPoint { x, y:(0..5).map(|i| y+i as f64*10.0).collect(), angle:0.0 }).collect()).unwrap()
    }
    fn pair() -> Staff {
        let a=line(20.0); let b=line(100.0);
        let mut s=a.clone();s.max_y=b.max_y;s.halves=Some(Box::new((a,b)));s
    }
    #[test]
    fn existing_measure_count_blocks_duplicate_lines_despite_bad_attention() {
        use homr_rs::tokens::Symbol;
        let complete = [Symbol::new("note_16"), Symbol::new("barline"), Symbol::new("note_16"), Symbol::new("barline")];
        assert_eq!(missing_boundary_budget(1,&complete),0);
        assert_eq!(missing_boundary_budget(2,&complete),1);
        assert_eq!(missing_boundary_budget(0,&complete),0);
        assert_eq!(missing_boundary_budget(2,&[]),0);
    }
    #[test]
    fn distinguishes_connected_barlines_from_aligned_note_stems() {
        let mut image=Gray::new(220,160,255);
        for y in [20,30,40,50,60,100,110,120,130,140] { for x in 10..211 { image.data[y*220+x]=0; } }
        // Aligned note stems on both staves do not bridge the inter-staff gap.
        for y in 25..61 { image.data[y*220+50]=0; }
        for y in 100..136 { image.data[y*220+50]=0; }
        for y in 20..141 { image.data[y*220+90]=0; }
        assert_eq!(connected_barlines(&image,&pair()),vec![90.0]);
        assert!(connected_barlines(&image,&line(20.0)).is_empty());
    }
    #[test]
    fn double_barline_is_one_boundary_and_broken_ambiguous_lines_are_ignored() {
        let mut image=Gray::new(220,160,255);
        for y in 20..141 { for x in [90,95] { image.data[y*220+x]=0; } }
        for y in 20..141 { if !(70..90).contains(&y) {image.data[y*220+150]=0;} }
        assert_eq!(connected_barlines(&image,&pair()),vec![90.0]);
    }
}

/// Repair a clipped staff only when its five actual printed lines are visible
/// throughout the missing range. This is image verification, not a piano prior.
pub fn restore_staff_extent(image: &Gray, staff: &Staff, other: &Staff) -> Staff {
    use homr_rs::staff::StaffPoint;
    if staff.grid.len() < 2 || staff.grid[0].y.len()!=5 { return staff.clone(); }
    let unit=(staff.max_y-staff.min_y)/4.0;
    let mut grid=staff.grid.clone();
    for left in [true,false] {
        let (edge,near)=if left { (&staff.grid[0],&staff.grid[1]) } else { (&staff.grid[staff.grid.len()-1],&staff.grid[staff.grid.len()-2]) };
        let target=if left { other.min_x } else { other.max_x };
        if (left && target>=staff.min_x-3.0*unit) || (!left && target<=staff.max_x+3.0*unit) { continue; }
        let dx=edge.x-near.x;
        if dx.abs()<1.0 {continue;}
        let slopes:Vec<f64>=edge.y.iter().zip(&near.y).map(|(a,b)| (a-b)/dx).collect();
        if slopes.iter().any(|s|s.abs()>0.1) {continue;}
        let lo=target.min(edge.x).ceil().max(2.0) as usize;
        let hi=target.max(edge.x).floor().min((image.w-3) as f64) as usize;
        if hi<=lo {continue;}
        let step=(unit/2.0).round().max(1.0) as usize;
        let mut hits=[0usize;5];let mut white_gaps=[0usize;4];let mut total=0;
        for x in (lo..=hi).step_by(step) {
            total+=1;
            for (line,&slope) in slopes.iter().enumerate() {
                let y=(edge.y[line]+(x as f64-edge.x)*slope).round() as isize;
                if y<2 || y>=image.h as isize-2 {continue;}
                if (-1..=1).any(|dy| image.at(x,(y+dy) as usize)<150) {hits[line]+=1;}
                if line<4 {
                    let next=edge.y[line+1]+(x as f64-edge.x)*slopes[line+1];
                    let middle=((y as f64+next)/2.0).round() as isize;
                    if middle>=1 && middle<image.h as isize-1 && image.at(x,middle as usize)>180 {white_gaps[line]+=1;}
                }
            }
        }
        if total<8 || hits.iter().any(|&n| n as f64 / (total as f64)<0.85) || white_gaps.iter().any(|&n|n as f64/(total as f64)<0.55) {continue;}
        for point in &other.grid {
            if (left && point.x<staff.min_x) || (!left && point.x>staff.max_x) {
                grid.push(StaffPoint{x:point.x,y:edge.y.iter().zip(&slopes).map(|(y,s)| y+(point.x-edge.x)*s).collect(),angle:edge.angle});
            }
        }
    }
    grid.sort_by(|a,b|a.x.total_cmp(&b.x));
    Staff::from_grid(grid).unwrap_or_else(|_|staff.clone())
}

#[cfg(test)]
mod extent_tests {
    use super::*;
    use homr_rs::staff::StaffPoint;
    fn staff(start:f64,y:f64)->Staff { Staff::from_grid([start,start+10.0,200.0].into_iter().map(|x|StaffPoint{x,y:(0..5).map(|n|y+n as f64*10.0).collect(),angle:0.0}).collect()).unwrap() }
    #[test]
    fn printed_line_evidence_restores_a_fragment_but_does_not_invent_a_hidden_staff() {
        let mut image=Gray::new(220,180,255);
        let fragment=staff(110.0,20.0);let other=staff(10.0,100.0);
        assert_eq!(restore_staff_extent(&image,&fragment,&other).min_x,110.0);
        let black=Gray::new(220,180,0);
        assert_eq!(restore_staff_extent(&black,&fragment,&other).min_x,110.0);
        for y in [20,30,40,50,60] {for x in 10..201 {image.data[y*220+x]=0;}}
        assert_eq!(restore_staff_extent(&image,&fragment,&other).min_x,10.0);
        // Four lines are insufficient; a real five-line staff is required.
        for x in 10..110 {image.data[40*220+x]=255;}
        assert_eq!(restore_staff_extent(&image,&fragment,&other).min_x,110.0);
    }
}
